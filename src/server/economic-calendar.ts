/**
 * Economic calendar - server (lot 10, roadmap section 12).
 *
 * Three sources feed one table (EconomicEvent):
 * - FRED (official, free key): scheduled dates + actual values (US macro).
 * - ForexFactory (unofficial feed, no key): schedule + forecast + impact.
 * - MANUAL: the user's own events, authoritative, never touched by sync.
 *
 * One row per real-world event (dedupeKey). Merge precedence lives in
 * src/lib/economic-calendar/providers.ts (mergeProviderEvent). Per-source
 * health lives in EconomicCalendarSyncState. Pre-event alerts go through
 * the in-app notification center only (no email, no push).
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  buildDedupeKey,
  EVENT_STALE_AFTER_MS,
  mergeProviderEvent,
  parseSourceMeta,
  passesMinImpact,
  SOURCE_STALE_AFTER_MS,
  SYNC_THROTTLE_MS,
  type EconomicEventSource,
  type EconomicImpact,
  type NormalizedEconomicEvent,
  type SourceMeta,
} from "@/lib/economic-calendar/providers";
import { fetchFredEvents } from "@/lib/economic-calendar/fred";
import { fetchForexFactoryEvents } from "@/lib/economic-calendar/forexfactory";
import { notifyUser } from "@/server/notifications";
import type { ManualEconomicEventInput, WatchlistPrefsInput } from "@/lib/validations/economic-calendar";

export class EconomicCalendarError extends Error {
  readonly code: string;
  readonly status: number;
  readonly existingEventId?: string;
  constructor(code: string, status: number, existingEventId?: string) {
    super(code);
    this.name = "EconomicCalendarError";
    this.code = code;
    this.status = status;
    this.existingEventId = existingEventId;
  }
}

export { EVENT_STALE_AFTER_MS, SOURCE_STALE_AFTER_MS, SYNC_THROTTLE_MS } from "@/lib/economic-calendar/providers";

/** Auto-link windows (minutes, trade entry minus event time). */
export const LINK_BEFORE_MINUTES = 60;
export const LINK_DURING_MINUTES = 5;
export const LINK_AFTER_MINUTES = 120;

export interface EconomicEventDTO {
  id: string;
  title: string;
  currency: string;
  country: string | null;
  impact: EconomicImpact | null;
  category: string;
  scheduledAt: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  unit: string | null;
  source: string;
  sourceUpdatedAt: string | null;
  /** True when the row is a manual event owned by the viewer (editable). */
  isManual: boolean;
}

export interface EconomicCalendarSourceDTO {
  source: EconomicEventSource;
  status: "OK" | "STALE" | "DOWN" | "NOT_CONFIGURED";
  lastSyncAt: string | null;
  lastError: string | null;
  /** Events touched by the last successful run (0 when never synced). */
  eventCount: number;
  /** FRED only: false until a key is set. Always true for the others. */
  configured: boolean;
}

export interface WatchlistPrefsDTO {
  currencies: string[];
  categories: string[];
  minImpact: string;
  alertsEnabled: boolean;
  alertMinutesBefore: number;
}

export interface TradeEventLinkDTO {
  eventId: string;
  tradeId: string;
  phase: string;
  offsetMinutes: number;
  autoLinked: boolean;
  event: EconomicEventDTO;
}

export interface TradeEventContextDTO {
  trade: { id: string; entryTime: string; symbol: string | null };
  snapshot: {
    atr14Pips: string | null;
    volatilityRegime: string;
    trendRegime: string;
    computedAt: string;
  } | null;
  events: Array<{
    id: string;
    title: string;
    currency: string;
    scheduledAt: string;
    phase: string;
    offsetMinutes: number;
  }>;
}

type EventRow = {
  id: string;
  title: string;
  currency: string;
  country: string | null;
  impact: string | null;
  category: string;
  scheduledAt: Date;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  unit: string | null;
  source: string;
  sourceUpdatedAt: Date | null;
};

function toDTO(row: EventRow): EconomicEventDTO {
  return {
    id: row.id,
    title: row.title,
    currency: row.currency,
    country: row.country,
    impact: (row.impact as EconomicImpact | null) ?? null,
    category: row.category,
    scheduledAt: row.scheduledAt.toISOString(),
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    unit: row.unit,
    source: row.source,
    sourceUpdatedAt: row.sourceUpdatedAt ? row.sourceUpdatedAt.toISOString() : null,
    isManual: row.source === "MANUAL",
  };
}

const DEFAULT_WATCHLIST: WatchlistPrefsDTO = {
  currencies: ["USD"],
  categories: [],
  minImpact: "MEDIUM",
  alertsEnabled: true,
  alertMinutesBefore: 60,
};

export interface ListEconomicEventsFilters {
  from?: string;
  to?: string;
  currencies?: string[];
  countries?: string[];
  /** Impact values to keep; "UNRATED" matches null impact. */
  impacts?: string[];
  categories?: string[];
  sources?: string[];
  watchlistOnly?: boolean;
  limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultWindow(now: Date): { from: Date; to: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return {
    from: new Date(start.getTime() - 7 * DAY_MS),
    to: new Date(start.getTime() + 35 * DAY_MS),
  };
}

export async function listEconomicEvents(
  userId: string,
  filters: ListEconomicEventsFilters = {},
): Promise<EconomicEventDTO[]> {
  const now = new Date();
  const window = defaultWindow(now);
  const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : window.from;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : window.to;

  let currencies = filters.currencies ?? [];
  let categories = filters.categories ?? [];
  let minImpact: string | null = null;
  if (filters.watchlistOnly) {
    const prefs = await getWatchlistPrefs(userId);
    if (prefs.currencies.length > 0) currencies = prefs.currencies;
    if (prefs.categories.length > 0) categories = prefs.categories;
    minImpact = prefs.minImpact;
  }

  const where: Prisma.EconomicEventWhereInput = {
    scheduledAt: { gte: from, lte: to },
    OR: [{ userId: null }, { userId }],
  };
  if (currencies.length > 0) where.currency = { in: currencies };
  if (filters.countries && filters.countries.length > 0) where.country = { in: filters.countries };
  if (categories.length > 0) where.category = { in: categories };
  if (filters.sources && filters.sources.length > 0) where.source = { in: filters.sources };
  if (filters.impacts && filters.impacts.length > 0) {
    const rated = filters.impacts.filter((impact) => impact !== "UNRATED");
    const wantsUnrated = filters.impacts.includes("UNRATED");
    // Prisma cannot OR a null-equals with an in-list in one clause, so the
    // unrated case is handled by fetching rated + unrated separately below.
    // Here we only constrain when no unrated rows are wanted.
    if (!wantsUnrated) {
      where.impact = { in: rated };
    }
  }

  const rows = await db.economicEvent.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    take: filters.limit ?? 200,
  });

  let events = rows.map(toDTO);
  if (filters.impacts && filters.impacts.includes("UNRATED")) {
    const rated = filters.impacts.filter((impact) => impact !== "UNRATED");
    events = events.filter(
      (event) => event.impact == null || rated.includes(event.impact),
    );
  }
  if (minImpact) {
    events = events.filter((event) => passesMinImpact(event.impact, minImpact));
  }
  return events;
}

export async function getEconomicEvent(
  userId: string,
  id: string,
): Promise<{ event: EconomicEventDTO; trades: TradeEventLinkDTO[] } | null> {
  const row = await db.economicEvent.findFirst({
    where: { id, OR: [{ userId: null }, { userId }] },
  });
  if (!row) return null;
  const links = await db.tradeEventLink.findMany({
    where: { eventId: id, trade: { userId } },
    include: { trade: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    event: toDTO(row),
    trades: links.map((link) => ({
      eventId: link.eventId,
      tradeId: link.tradeId,
      phase: link.phase,
      offsetMinutes: link.offsetMinutes,
      autoLinked: link.autoLinked,
      event: toDTO(row),
    })),
  };
}

export async function getEconomicCalendarSources(): Promise<EconomicCalendarSourceDTO[]> {
  const states = await db.economicCalendarSyncState.findMany();
  const bySource = new Map(states.map((state) => [state.source, state]));
  const fredConfigured = Boolean(process.env.FRED_API_KEY);
  const manualCount = await db.economicEvent.count({ where: { source: "MANUAL" } });

  const toSourceDTO = (
    source: EconomicEventSource,
    configured: boolean,
  ): EconomicCalendarSourceDTO => {
    const state = bySource.get(source);
    if (!state) {
      return {
        source,
        status: source === "FRED" && !configured ? "NOT_CONFIGURED" : "STALE",
        lastSyncAt: null,
        lastError: null,
        eventCount: 0,
        configured,
      };
    }
    const status = state.status as EconomicCalendarSourceDTO["status"];
    const stale =
      status === "OK" &&
      state.lastSyncAt != null &&
      Date.now() - state.lastSyncAt.getTime() > SOURCE_STALE_AFTER_MS;
    return {
      source,
      status: stale ? "STALE" : status,
      lastSyncAt: state.lastSyncAt ? state.lastSyncAt.toISOString() : null,
      lastError: state.lastError,
      eventCount: state.eventCount,
      configured,
    };
  };

  const fred = toSourceDTO("FRED", fredConfigured);
  const forexFactory = toSourceDTO("FOREXFACTORY", true);
  const manual: EconomicCalendarSourceDTO = {
    source: "MANUAL",
    status: "OK",
    lastSyncAt: null,
    lastError: null,
    eventCount: manualCount,
    configured: true,
  };
  return [fred, forexFactory, manual];
}

async function setSyncState(
  source: "FRED" | "FOREXFACTORY",
  patch: { status: string; lastSyncAt?: Date | null; lastError?: string | null; eventCount?: number },
): Promise<void> {
  await db.economicCalendarSyncState.upsert({
    where: { source },
    create: {
      source,
      status: patch.status,
      lastSyncAt: patch.lastSyncAt ?? null,
      lastError: patch.lastError ?? null,
      eventCount: patch.eventCount ?? 0,
    },
    update: {
      status: patch.status,
      ...(patch.lastSyncAt !== undefined ? { lastSyncAt: patch.lastSyncAt } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.eventCount !== undefined ? { eventCount: patch.eventCount } : {}),
    },
  });
}

interface SyncSourceReport {
  source: "FRED" | "FOREXFACTORY";
  status: "OK" | "STALE" | "DOWN" | "NOT_CONFIGURED" | "SKIPPED";
  fetched: number;
  created: number;
  updated: number;
  error: string | null;
}

export interface EconomicCalendarSyncReport {
  sources: SyncSourceReport[];
  alertsSent: number;
}

async function upsertProviderEvent(
  event: NormalizedEconomicEvent,
  source: "FRED" | "FOREXFACTORY",
  now: Date,
): Promise<"created" | "updated" | "skipped"> {
  const dedupeKey = buildDedupeKey(event.title, event.scheduledAt, event.currency);
  const existing = await db.economicEvent.findUnique({ where: { dedupeKey } });
  if (!existing) {
    const sourceMeta: SourceMeta = {
      [source]: { updatedAt: now.toISOString(), externalId: event.externalId },
    };
    await db.economicEvent.create({
      data: {
        userId: null,
        source,
        externalId: event.externalId,
        title: event.title,
        currency: event.currency,
        country: event.country,
        impact: event.impact,
        category: event.category,
        scheduledAt: event.scheduledAt,
        actual: event.actual,
        forecast: event.forecast,
        previous: event.previous,
        unit: event.unit,
        dedupeKey,
        sourceMeta: JSON.stringify(sourceMeta),
        sourceUpdatedAt: now,
      },
    });
    return "created";
  }
  // A manual event is authoritative: sync never overwrites or deletes it.
  if (existing.source === "MANUAL") return "skipped";
  const merged = mergeProviderEvent(
    {
      source: existing.source,
      scheduledAt: existing.scheduledAt,
      actual: existing.actual,
      forecast: existing.forecast,
      previous: existing.previous,
      impact: (existing.impact as EconomicImpact | null) ?? null,
      sourceMeta: parseSourceMeta(existing.sourceMeta),
    },
    { ...event, source },
    now,
  );
  await db.economicEvent.update({
    where: { id: existing.id },
    data: {
      scheduledAt: merged.scheduledAt,
      actual: merged.actual,
      forecast: merged.forecast,
      previous: merged.previous,
      impact: merged.impact,
      source: merged.source,
      sourceMeta: JSON.stringify(merged.sourceMeta),
      sourceUpdatedAt: now,
    },
  });
  return "updated";
}

export async function runEconomicCalendarSync(options?: {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: Date;
  force?: boolean;
}): Promise<EconomicCalendarSyncReport> {
  const now = options?.now ?? new Date();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 35 * DAY_MS).toISOString().slice(0, 10);

  const states = await db.economicCalendarSyncState.findMany();
  const lastOk = new Map(
    states
      .filter((state) => state.status === "OK" && state.lastSyncAt)
      .map((state) => [state.source, state.lastSyncAt as Date]),
  );
  const throttled = (source: string): boolean =>
    !options?.force &&
    lastOk.has(source) &&
    now.getTime() - (lastOk.get(source) as Date).getTime() < SYNC_THROTTLE_MS;

  const reports: SyncSourceReport[] = [];

  // ── FRED ──────────────────────────────────────────────────────────────────
  if (throttled("FRED")) {
    reports.push({ source: "FRED", status: "SKIPPED", fetched: 0, created: 0, updated: 0, error: null });
  } else if (!process.env.FRED_API_KEY) {
    await setSyncState("FRED", { status: "NOT_CONFIGURED", lastError: null });
    reports.push({
      source: "FRED",
      status: "NOT_CONFIGURED",
      fetched: 0,
      created: 0,
      updated: 0,
      error: null,
    });
  } else {
    try {
      const result = await fetchFredEvents({
        apiKey: process.env.FRED_API_KEY,
        from,
        to,
        today,
        fetchImpl,
      });
      let created = 0;
      let updated = 0;
      for (const event of result.events) {
        const outcome = await upsertProviderEvent(event, "FRED", now);
        if (outcome === "created") created += 1;
        if (outcome === "updated") updated += 1;
      }
      await setSyncState("FRED", {
        status: "OK",
        lastSyncAt: now,
        lastError: null,
        eventCount: result.events.length,
      });
      reports.push({
        source: "FRED",
        status: "OK",
        fetched: result.events.length,
        created,
        updated,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FRED sync failed.";
      await setSyncState("FRED", { status: "DOWN", lastError: message });
      reports.push({ source: "FRED", status: "DOWN", fetched: 0, created: 0, updated: 0, error: message });
    }
  }

  // ── ForexFactory ────────────────────────────────────────────────────────────
  if (throttled("FOREXFACTORY")) {
    reports.push({ source: "FOREXFACTORY", status: "SKIPPED", fetched: 0, created: 0, updated: 0, error: null });
  } else {
    try {
      const events = await fetchForexFactoryEvents({ fetchImpl });
      let created = 0;
      let updated = 0;
      for (const event of events) {
        const outcome = await upsertProviderEvent(event, "FOREXFACTORY", now);
        if (outcome === "created") created += 1;
        if (outcome === "updated") updated += 1;
      }
      await setSyncState("FOREXFACTORY", {
        status: "OK",
        lastSyncAt: now,
        lastError: null,
        eventCount: events.length,
      });
      reports.push({
        source: "FOREXFACTORY",
        status: "OK",
        fetched: events.length,
        created,
        updated,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ForexFactory sync failed.";
      await setSyncState("FOREXFACTORY", { status: "DOWN", lastError: message });
      reports.push({
        source: "FOREXFACTORY",
        status: "DOWN",
        fetched: 0,
        created: 0,
        updated: 0,
        error: message,
      });
    }
  }

  // A dead source never blocks the others, and alerts still run.
  let alertsSent = 0;
  try {
    alertsSent = await checkUpcomingEventAlerts(now);
  } catch {
    alertsSent = 0;
  }
  return { sources: reports, alertsSent };
}

// ── Manual events ─────────────────────────────────────────────────────────────

export async function createManualEvent(
  userId: string,
  input: ManualEconomicEventInput,
): Promise<EconomicEventDTO> {
  const scheduledAt = new Date(input.scheduledAt);
  const dedupeKey = buildDedupeKey(input.title, scheduledAt, input.currency);
  const existing = await db.economicEvent.findUnique({ where: { dedupeKey } });
  if (existing) {
    throw new EconomicCalendarError("EVENT_ALREADY_EXISTS", 409, existing.id);
  }
  const row = await db.economicEvent.create({
    data: {
      userId,
      source: "MANUAL",
      externalId: dedupeKey,
      title: input.title,
      currency: input.currency,
      country: input.country ?? null,
      impact: input.impact,
      category: input.category,
      scheduledAt,
      actual: input.actual ?? null,
      forecast: input.forecast ?? null,
      previous: input.previous ?? null,
      unit: input.unit ?? null,
      dedupeKey,
    },
  });
  return toDTO(row);
}

export async function updateManualEvent(
  userId: string,
  id: string,
  input: ManualEconomicEventInput,
): Promise<EconomicEventDTO> {
  const row = await db.economicEvent.findFirst({
    where: { id, userId, source: "MANUAL" },
  });
  if (!row) throw new EconomicCalendarError("EVENT_NOT_FOUND", 404);
  const scheduledAt = new Date(input.scheduledAt);
  const dedupeKey = buildDedupeKey(input.title, scheduledAt, input.currency);
  if (dedupeKey !== row.dedupeKey) {
    const clash = await db.economicEvent.findUnique({ where: { dedupeKey } });
    if (clash) {
      throw new EconomicCalendarError("EVENT_ALREADY_EXISTS", 409, clash.id);
    }
  }
  const updated = await db.economicEvent.update({
    where: { id },
    data: {
      title: input.title,
      currency: input.currency,
      country: input.country ?? null,
      impact: input.impact,
      category: input.category,
      scheduledAt,
      actual: input.actual ?? null,
      forecast: input.forecast ?? null,
      previous: input.previous ?? null,
      unit: input.unit ?? null,
      dedupeKey,
    },
  });
  return toDTO(updated);
}

export async function deleteManualEvent(userId: string, id: string): Promise<boolean> {
  const row = await db.economicEvent.findFirst({
    where: { id, userId, source: "MANUAL" },
  });
  if (!row) return false;
  await db.economicEvent.delete({ where: { id } });
  return true;
}

// ── Watchlist preferences ─────────────────────────────────────────────────────

export async function getWatchlistPrefs(userId: string): Promise<WatchlistPrefsDTO> {
  const row = await db.eventWatchlist.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_WATCHLIST };
  let currencies: string[] = DEFAULT_WATCHLIST.currencies;
  let categories: string[] = DEFAULT_WATCHLIST.categories;
  try {
    const parsedCurrencies: unknown = JSON.parse(row.currencies);
    if (Array.isArray(parsedCurrencies)) {
      currencies = parsedCurrencies.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // Corrupt prefs fall back to defaults, never a crash.
  }
  try {
    const parsedCategories: unknown = JSON.parse(row.categories);
    if (Array.isArray(parsedCategories)) {
      categories = parsedCategories.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // Same as above.
  }
  return {
    currencies,
    categories,
    minImpact: row.minImpact,
    alertsEnabled: row.alertsEnabled,
    alertMinutesBefore: row.alertMinutesBefore,
  };
}

export async function updateWatchlistPrefs(
  userId: string,
  input: WatchlistPrefsInput,
): Promise<WatchlistPrefsDTO> {
  await db.eventWatchlist.upsert({
    where: { userId },
    create: {
      userId,
      currencies: JSON.stringify(input.currencies),
      categories: JSON.stringify(input.categories),
      minImpact: input.minImpact,
      alertsEnabled: input.alertsEnabled,
      alertMinutesBefore: input.alertMinutesBefore,
    },
    update: {
      currencies: JSON.stringify(input.currencies),
      categories: JSON.stringify(input.categories),
      minImpact: input.minImpact,
      alertsEnabled: input.alertsEnabled,
      alertMinutesBefore: input.alertMinutesBefore,
    },
  });
  return getWatchlistPrefs(userId);
}

// ── Trade links + market context ──────────────────────────────────────────────

/** Phase of a trade entry relative to an event (offset = entry minus event). */
export function phaseForOffset(offsetMinutes: number): "BEFORE" | "DURING" | "AFTER" {
  if (offsetMinutes < -LINK_DURING_MINUTES) return "BEFORE";
  if (offsetMinutes > LINK_DURING_MINUTES) return "AFTER";
  return "DURING";
}

export async function linkEventToTrade(
  userId: string,
  tradeId: string,
  eventId: string,
): Promise<TradeEventLinkDTO> {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true, entryTime: true },
  });
  if (!trade) throw new EconomicCalendarError("TRADE_NOT_FOUND", 404);
  const event = await db.economicEvent.findFirst({
    where: { id: eventId, OR: [{ userId: null }, { userId }] },
  });
  if (!event) throw new EconomicCalendarError("EVENT_NOT_FOUND", 404);
  const offsetMinutes = Math.round(
    (trade.entryTime.getTime() - event.scheduledAt.getTime()) / 60000,
  );
  const link = await db.tradeEventLink.upsert({
    where: { tradeId_eventId: { tradeId, eventId } },
    create: {
      tradeId,
      eventId,
      offsetMinutes,
      phase: phaseForOffset(offsetMinutes),
      autoLinked: false,
    },
    update: {
      offsetMinutes,
      phase: phaseForOffset(offsetMinutes),
      autoLinked: false,
    },
  });
  return {
    eventId: link.eventId,
    tradeId: link.tradeId,
    phase: link.phase,
    offsetMinutes: link.offsetMinutes,
    autoLinked: link.autoLinked,
    event: toDTO(event),
  };
}

export async function unlinkEventFromTrade(
  userId: string,
  tradeId: string,
  eventId: string,
): Promise<boolean> {
  const trade = await db.trade.findFirst({ where: { id: tradeId, userId }, select: { id: true } });
  if (!trade) return false;
  const result = await db.tradeEventLink.deleteMany({ where: { tradeId, eventId } });
  return result.count > 0;
}

/**
 * Auto-link events around a trade entry (BEFORE 60 min / DURING 5 min /
 * AFTER 120 min). Best-effort: never throws, so trade saves and syncs
 * keep working when linking fails.
 */
export async function autoLinkEventsForTrade(userId: string, tradeId: string): Promise<number> {
  try {
    const trade = await db.trade.findFirst({
      where: { id: tradeId, userId },
      select: { id: true, entryTime: true },
    });
    if (!trade) return 0;
    const from = new Date(trade.entryTime.getTime() - LINK_BEFORE_MINUTES * 60000);
    const to = new Date(trade.entryTime.getTime() + LINK_AFTER_MINUTES * 60000);
    const events = await db.economicEvent.findMany({
      where: {
        scheduledAt: { gte: from, lte: to },
        OR: [{ userId: null }, { userId }],
      },
      select: { id: true, scheduledAt: true },
    });
    let linked = 0;
    for (const event of events) {
      const offsetMinutes = Math.round(
        (trade.entryTime.getTime() - event.scheduledAt.getTime()) / 60000,
      );
      await db.tradeEventLink.upsert({
        where: { tradeId_eventId: { tradeId, eventId: event.id } },
        create: {
          tradeId,
          eventId: event.id,
          offsetMinutes,
          phase: phaseForOffset(offsetMinutes),
          autoLinked: true,
        },
        update: {},
      });
      linked += 1;
    }
    return linked;
  } catch {
    return 0;
  }
}

export async function getTradeEventContext(
  userId: string,
  tradeId: string,
): Promise<TradeEventContextDTO | null> {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: {
      id: true,
      entryTime: true,
      instrument: { select: { symbol: true } },
    },
  });
  if (!trade) return null;
  const snapshot = await db.marketContextSnapshot.findFirst({ where: { tradeId } });
  const links = await db.tradeEventLink.findMany({
    where: { tradeId },
    include: { event: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    trade: {
      id: trade.id,
      entryTime: trade.entryTime.toISOString(),
      symbol: trade.instrument?.symbol ?? null,
    },
    snapshot: snapshot
      ? {
          atr14Pips: snapshot.atr14Pips.toString(),
          volatilityRegime: snapshot.volatilityRegime,
          trendRegime: snapshot.trendRegime,
          computedAt: snapshot.computedAt.toISOString(),
        }
      : null,
    events: links.map((link) => ({
      id: link.event.id,
      title: link.event.title,
      currency: link.event.currency,
      scheduledAt: link.event.scheduledAt.toISOString(),
      phase: link.phase,
      offsetMinutes: link.offsetMinutes,
    })),
  };
}

// ── Pre-event alerts ──────────────────────────────────────────────────────────

/**
 * Notify users whose watchlist matches an event starting within their
 * alert window. In-app + Web Push fan-out (notifyUser). Dedupe key is the event id,
 * window 12 h, so a user is pinged at most once per event per half day.
 * Titles and bodies follow the existing server-side notification strings
 * (French, like the other composers in this service).
 */
export async function checkUpcomingEventAlerts(now?: Date): Promise<number> {
  const at = now ?? new Date();
  const watchlists = await db.eventWatchlist.findMany({
    where: { alertsEnabled: true },
  });
  let sent = 0;
  for (const prefs of watchlists) {
    const until = new Date(at.getTime() + prefs.alertMinutesBefore * 60000);
    const events = await db.economicEvent.findMany({
      where: {
        scheduledAt: { gt: at, lte: until },
        OR: [{ userId: null }, { userId: prefs.userId }],
      },
      orderBy: { scheduledAt: "asc" },
      take: 20,
    });
    let currencies: string[] = [];
    let categories: string[] = [];
    try {
      const parsed: unknown = JSON.parse(prefs.currencies);
      if (Array.isArray(parsed)) {
        currencies = parsed.filter((c): c is string => typeof c === "string");
      }
    } catch {
      // Defaults apply.
    }
    try {
      const parsed: unknown = JSON.parse(prefs.categories);
      if (Array.isArray(parsed)) {
        categories = parsed.filter((c): c is string => typeof c === "string");
      }
    } catch {
      // Defaults apply.
    }
    for (const event of events) {
      if (currencies.length > 0 && !currencies.includes(event.currency)) continue;
      if (categories.length > 0 && !categories.includes(event.category)) continue;
      if (!passesMinImpact((event.impact as EconomicImpact | null) ?? null, prefs.minImpact)) {
        continue;
      }
      // notifyUser returns false when the alert was deduped away: only
      // actually created notifications count as sent.
      if (
        await notifyUser({
          userId: prefs.userId,
          type: "ECONOMIC_EVENT_SOON",
          title: `Annonce économique bientôt : ${event.title}`,
          body: `${event.currency} - ${event.title} commence bientôt. Consultez le calendrier économique avant de trader.`,
          url: "/economic-calendar",
          dedupeKey: `event:${event.id}`,
          dedupeWithinMs: 12 * 60 * 60 * 1000,
        })
      ) {
        sent += 1;
      }
    }
  }
  return sent;
}
