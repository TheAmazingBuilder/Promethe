/**
 * v2.5 Module 2 — chart data access (server-only).
 *
 * Every function takes userId explicitly and scopes DB reads/writes by it
 * (the sandbox SQLite equivalent of RLS — see tests/integration/isolation*).
 *
 * - getBuilderTrades: filtered CLOSED trades mapped to the pure builder's
 *   BuilderTrade shape, timezone-aware local parts computed HERE (the engine
 *   stays pure), MFE/MAE converted to R via excursionR().
 * - SavedChart CRUD with ownership checks.
 */
import { db } from "@/lib/db";
import { excursionR, type BuilderTrade } from "@/lib/charts/builder";
import {
  CANDLE_TIMEFRAMES,
  TF_MINUTES,
  type CandleDTO,
  type CandleImportInput,
  type CandleTimeframe,
  type CandleWindowQuery,
} from "@/lib/validations/charts";
import {
  isValidTimezone,
  parseCandleRowInTimezone,
} from "@/lib/charts/price";
import Papa from "papaparse";
import type { Prisma, Trade as TradeRow } from "@prisma/client";
import type {
  BuilderDataQuery,
  SavedChartInput,
  SavedChartPatch,
} from "@/lib/validations/charts";

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
} as const;

type Row = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;

/** Hard cap on the builder payload (most recent N closed trades). */
export const BUILDER_TRADE_CAP = 5000;

// ── Timezone helpers (user's profile timezone, same convention as analytics) ─

interface LocalParts {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  weekday: number; // 1 (Mon) → 7 (Sun)
  month: number; // 1-12
  dayOfMonth: number; // 1-31
  isoWeek: number; // 1-53
}

/** Local parts of a Date in `timezone` - null on invalid TZ. */
export function localParts(date: Date, timezone: string): LocalParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const hour = Number.parseInt(parts.hour ?? "", 10);
    const day = Number.parseInt(parts.day ?? "", 10);
    const month = Number.parseInt(parts.month ?? "", 10);
    const year = Number.parseInt(parts.year ?? "", 10);
    if (![hour, day, month, year].every(Number.isFinite)) return null;
    const iso = `${parts.year}-${parts.month}-${parts.day}`;
    return {
      date: iso,
      hour,
      weekday: isoWeekdayOf(iso),
      month,
      dayOfMonth: day,
      isoWeek: isoWeekNumberOf(iso),
    };
  } catch {
    return null;
  }
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date (proleptic Gregorian). */
function isoWeekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Day-of-week via Zeller-like epoch math (UTC-based, TZ-agnostic).
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** ISO 8601 week number of a YYYY-MM-DD date. */
function isoWeekNumberOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  // Thursday of the current week decides the ISO year.
  const dayNum = date.getUTCDay() || 7; // 1-7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ── Builder trades payload ───────────────────────────────────────────────────

export interface BuilderDataPayload {
  currency: string;
  timezone: string;
  trades: BuilderTrade[];
  truncated: boolean;
  /** True when the requested account filter no longer exists - the
   * payload then covers all accounts (same fallback as before, now
   * reported instead of silent). */
  accountMissing: boolean;
}

function periodCutoff(period: BuilderDataQuery["period"]): Date | null {
  const now = new Date();
  switch (period) {
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "ytd":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    default:
      return null;
  }
}

function toBuilderTrade(t: Row, timezone: string): BuilderTrade {
  const exit = t.exitTime ?? t.entryTime;
  const exitLocal = localParts(exit, timezone);
  const entryLocal = localParts(t.entryTime, timezone);
  const durationMin =
    t.exitTime != null
      ? Math.max(
          0,
          Math.round((t.exitTime.getTime() - t.entryTime.getTime()) / (60 * 1000))
        )
      : null;
  const { mfeR, maeR } = excursionR(
    t.direction,
    t.entryPrice?.toString() ?? null,
    t.mfePrice?.toString() ?? null,
    t.maePrice?.toString() ?? null,
    t.initialStopLoss?.toString() ?? null,
    t.stopLoss?.toString() ?? null
  );

  return {
    id: t.id,
    entryTime: t.entryTime.toISOString(),
    exitTime: exit.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyId: t.strategyId,
    strategyName: t.strategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
    accountId: t.accountId,
    accountName: t.account.name,
    timeframe: t.timeframe,
    setupType: t.setupType,
    marketCondition: t.marketCondition,
    exitReason: t.exitReason,
    emotionBefore: t.emotionBefore,
    emotionDuring: t.emotionDuring,
    emotionAfter: t.emotionAfter,
    confidence: t.confidence,
    setupQualityRating: t.setupQualityRating,
    followedPlan: t.followedPlan,
    pips: t.pips?.toString() ?? null,
    points: t.points?.toString() ?? null,
    riskPercent: t.riskPercent?.toString() ?? null,
    mfeR,
    maeR,
    durationMin,
    tags: t.tags.map((tt) => tt.tag.name),
    mistakes: t.tags.filter((tt) => tt.tag.kind === "MISTAKE").map((tt) => tt.tag.name),
    localDate: exitLocal?.date ?? null,
    localEntryDate: entryLocal?.date ?? null,
    localWeekday: entryLocal?.weekday ?? null,
    localHour: entryLocal?.hour ?? null,
    localMonth: entryLocal?.month ?? null,
    localDayOfMonth: entryLocal?.dayOfMonth ?? null,
    localIsoWeek: entryLocal?.isoWeek ?? null,
  };
}

export async function getBuilderTrades(
  userId: string,
  query: BuilderDataQuery
): Promise<BuilderDataPayload> {
  const [profile, accounts] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  // Account filter must belong to the user (silent fallback to "all").
  const accountFilter =
    query.account != null
      ? (accounts.find((a) => a.id === query.account) ?? null)
      : null;
  const accountMissing = query.account != null && accountFilter == null;

  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  const cutoff = periodCutoff(query.period);
  if (cutoff != null) where.exitTime = { gte: cutoff };

  const rows: Row[] = await db.trade.findMany({
    where,
    include: TRADE_INCLUDE,
    orderBy: { entryTime: "asc" },
    take: BUILDER_TRADE_CAP + 1, // +1 detects truncation
  });

  const truncated = rows.length > BUILDER_TRADE_CAP;
  const kept = truncated ? rows.slice(0, BUILDER_TRADE_CAP) : rows;
  const timezone = profile?.timezone ?? "UTC";
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";

  return {
    currency,
    timezone,
    trades: kept.map((t) => toBuilderTrade(t, timezone)),
    truncated,
    accountMissing,
  };
}

/** Trade row (no relations) → minimal BuilderTrade - test helper. */
export function toBuilderTradeFromRow(
  t: TradeRow & Partial<Row>,
  timezone: string
): BuilderTrade {
  return toBuilderTrade(t as Row, timezone);
}

// ── SavedChart CRUD (ownership-scoped) ───────────────────────────────────────

export interface SavedChartDTO {
  id: string;
  name: string;
  config: unknown; // parsed JSON
  createdAt: string;
  updatedAt: string;
}

function toDto(row: {
  id: string;
  name: string;
  configJson: string;
  createdAt: Date;
  updatedAt: Date;
}): SavedChartDTO {
  let config: unknown = null;
  try {
    config = JSON.parse(row.configJson);
  } catch {
    config = null;
  }
  return {
    id: row.id,
    name: row.name,
    config,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedCharts(userId: string): Promise<SavedChartDTO[]> {
  const rows = await db.savedChart.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toDto);
}

export async function getSavedChart(
  userId: string,
  id: string
): Promise<SavedChartDTO | null> {
  const row = await db.savedChart.findFirst({ where: { id, userId } });
  return row ? toDto(row) : null;
}

export async function createSavedChart(
  userId: string,
  input: SavedChartInput
): Promise<SavedChartDTO> {
  const row = await db.savedChart.create({
    data: {
      userId,
      name: input.name,
      configJson: JSON.stringify(input.config),
    },
  });
  return toDto(row);
}

export async function updateSavedChart(
  userId: string,
  id: string,
  patch: SavedChartPatch
): Promise<SavedChartDTO | null> {
  const existing = await db.savedChart.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await db.savedChart.update({
    where: { id },
    data: {
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.config != null
        ? { configJson: JSON.stringify(patch.config) }
        : {}),
    },
  });
  return toDto(row);
}

export async function deleteSavedChart(
  userId: string,
  id: string
): Promise<boolean> {
  const res = await db.savedChart.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

export async function countSavedCharts(userId: string): Promise<number> {
  return db.savedChart.count({ where: { userId } });
}

// ── Candle windows (v2.5 M2 Phase 3) ─────────────────────────────────────────

export interface CandleWindowPayload {
  instrumentId: string;
  symbol: string;
  digits: number;
  /** Pip size (replay pips / distances). */
  pipSize: string;
  /** Timeframe of the returned rows (finest stored ≤ requested). */
  timeframe: CandleTimeframe | null;
  /** All timeframes stored in this window (for the switcher hints). */
  storedTimeframes: CandleTimeframe[];
  from: string;
  to: string;
  candles: CandleDTO[];
  /** True when the window held more than CANDLE_MAX_WINDOW_BARS rows and
   * only the most recent ones were returned - the chart shows a shorter
   * range than requested, never silently. */
  truncated: boolean;
}

/** Hard caps (free tier / 500 MB budget - documented in README). */
export const CANDLE_MAX_ROWS_PER_IMPORT = 50_000;
export const CANDLE_MAX_WINDOW_BARS = 6_000;
export const CANDLE_USER_BUDGET = 250_000;
/** Prune candles older than this that don't touch a trade window (± days). */
export const CANDLE_PRUNE_DAYS = 365;
export const CANDLE_TRADE_PAD_DAYS = 5;

async function resolveInstrumentUsable(
  userId: string,
  instrumentId: string
) {
  const instrument = await db.instrument.findFirst({
    where: { id: instrumentId, OR: [{ userId: null }, { userId }] },
  });
  return instrument;
}

/**
 * Candle window for the price chart: rows at the FINEST stored timeframe ≤ the
 * requested one (the client resamples). Ownership: the instrument must be a
 * global preset or belong to the user.
 */
export async function getCandleWindow(
  userId: string,
  query: CandleWindowQuery
): Promise<CandleWindowPayload> {
  const instrument = await resolveInstrumentUsable(userId, query.instrumentId);
  if (!instrument) {
    throw new Error("INSTRUMENT_NOT_FOUND");
  }
  const from = new Date(query.from);
  const to = new Date(query.to);

  // Stored timeframes with rows in the window.
  const groups = await db.priceCandle.groupBy({
    by: ["timeframe"],
    where: {
      instrumentId: instrument.id,
      openTime: { gte: from, lte: to },
    },
    _count: { _all: true },
  });
  const available = groups
    .map((g) => g.timeframe as CandleTimeframe)
    .filter((tf) => (CANDLE_TIMEFRAMES as readonly string[]).includes(tf));
  const requested = query.timeframe;
  const candidates = available
    .filter((tf) => TF_MINUTES[tf] <= TF_MINUTES[requested])
    .sort((a, b) => TF_MINUTES[a] - TF_MINUTES[b]);
  const chosen = candidates[0] ?? null;

  let candles: CandleDTO[] = [];
  let truncated = false;
  if (chosen) {
    // Cap the payload: keep the LAST CANDLE_MAX_WINDOW_BARS of the window.
    // Fetch one extra row so the client can tell a full window from a cut
    // one (truncated = true means the chart starts later than requested).
    const rows = await db.priceCandle.findMany({
      where: {
        instrumentId: instrument.id,
        timeframe: chosen,
        openTime: { gte: from, lte: to },
      },
      orderBy: { openTime: "desc" },
      take: CANDLE_MAX_WINDOW_BARS + 1,
    });
    truncated = rows.length > CANDLE_MAX_WINDOW_BARS;
    candles = rows
      .slice(0, CANDLE_MAX_WINDOW_BARS)
      .map((r) => ({
        time: Math.floor(r.openTime.getTime() / 1000),
        open: r.open.toString(),
        high: r.high.toString(),
        low: r.low.toString(),
        close: r.close.toString(),
        volume: r.volume != null ? r.volume.toString() : null,
      }))
      .reverse();
  }

  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    digits: instrument.digits,
    pipSize: instrument.pipSize.toString(),
    timeframe: chosen,
    storedTimeframes: available.sort(
      (a, b) => TF_MINUTES[a] - TF_MINUTES[b]
    ),
    from: from.toISOString(),
    to: to.toISOString(),
    candles,
    truncated,
  };
}

/** One batch result, aligned by index with the request array. */
export interface CandleBatchResult {
  candles: CandleDTO[];
}

/**
 * Batch candle windows (Phase 2 perf, item 7) — the trades grid's mini
 * charts, one HTTP call instead of one GET per card.
 *
 * Windows are grouped by (instrumentId, timeframe) and served from ONE
 * union window per group (one getCandleWindow call), sliced per card in
 * memory. Cap guard: the union keeps only the LAST
 * CANDLE_MAX_WINDOW_BARS bars, so when a union returns that many rows
 * the earliest cards may have lost candles — the group then falls back
 * to one window fetch per card, still inside this single batch request.
 * A group that fails (unknown instrument) yields empty candles for its
 * cards instead of failing the whole batch.
 */
export async function getCandleBatch(
  userId: string,
  requests: CandleWindowQuery[]
): Promise<CandleBatchResult[]> {
  const results: CandleBatchResult[] = requests.map(() => ({ candles: [] }));
  interface Group {
    instrumentId: string;
    timeframe: CandleTimeframe;
    from: Date;
    to: Date;
    indexes: number[];
  }
  const groups = new Map<string, Group>();
  requests.forEach((req, i) => {
    const key = `${req.instrumentId}|${req.timeframe}`;
    const from = new Date(req.from);
    const to = new Date(req.to);
    const group = groups.get(key);
    if (group) {
      if (from < group.from) group.from = from;
      if (to > group.to) group.to = to;
      group.indexes.push(i);
    } else {
      groups.set(key, {
        instrumentId: req.instrumentId,
        timeframe: req.timeframe,
        from,
        to,
        indexes: [i],
      });
    }
  });

  await Promise.all(
    [...groups.values()].map(async (group) => {
      try {
        const union = await getCandleWindow(userId, {
          instrumentId: group.instrumentId,
          timeframe: group.timeframe,
          from: group.from.toISOString(),
          to: group.to.toISOString(),
        });
        if (union.candles.length >= CANDLE_MAX_WINDOW_BARS) {
          // Union was capped: fall back to one window fetch per card.
          await Promise.all(
            group.indexes.map(async (i) => {
              try {
                const single = await getCandleWindow(userId, requests[i]);
                results[i] = { candles: single.candles };
              } catch (error) {
                console.error(
                  `[charts] batch window ${i} failed:`,
                  error
                );
              }
            })
          );
          return;
        }
        for (const i of group.indexes) {
          const fromSec = Date.parse(requests[i].from) / 1000;
          const toSec = Date.parse(requests[i].to) / 1000;
          results[i] = {
            candles: union.candles.filter(
              (c) => c.time >= fromSec && c.time <= toSec
            ),
          };
        }
      } catch (error) {
        console.error(
          `[charts] batch group ${group.instrumentId}/${group.timeframe} failed:`,
          error
        );
      }
    })
  );
  return results;
}

// ── CSV candle import ────────────────────────────────────────────────────────

export interface CandleImportResult {
  imported: number;
  /** Duplicates skipped: same timestamp twice in the file, or already stored. */
  skipped: number;
  /** Rows rejected as unparseable or OHLC-inconsistent (never stored). */
  invalid: number;
  pruned: number;
  timeframe: CandleTimeframe;
  firstTime: string | null;
  lastTime: string | null;
}

/**
 * Import candles from CSV text. Timestamps are interpreted in the DECLARED
 * timezone (IANA or fixed +HH:MM) and converted to UTC before storage.
 * Duplicates (same instrument/timeframe/openTime) are skipped. Storage is
 * pruned to respect the budget (oldest first) and the trade-window policy.
 */
export async function importCandles(
  userId: string,
  input: CandleImportInput
): Promise<CandleImportResult> {
  const instrument = await resolveInstrumentUsable(userId, input.instrumentId);
  if (!instrument) {
    throw new Error("INSTRUMENT_NOT_FOUND");
  }
  if (!isValidTimezone(input.timezone)) {
    throw new Error("INVALID_TIMEZONE");
  }

  // Parse CSV (header row required).
  const parsed = Papa.parse<Record<string, string | undefined>>(input.csv, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    throw new Error("EMPTY_CSV");
  }
  if (rows.length > CANDLE_MAX_ROWS_PER_IMPORT) {
    throw new Error("TOO_MANY_ROWS");
  }

  // Timezone conversion is DST-safe per row (see parseCandleRowInTimezone).
  // Accounting is exact: every input row lands in exactly one bucket -
  // imported + skipped + invalid = rows.length.
  const seen = new Set<number>();
  let invalid = 0;
  let duplicateInFile = 0;
  const toInsert: Array<{
    instrumentId: string;
    timeframe: string;
    openTime: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string | null;
  }> = [];

  for (const row of rows) {
    const c = parseCandleRowInTimezone(row, input.timezone);
    if (c == null) {
      invalid += 1;
      continue;
    }
    if (seen.has(c.timeSec)) {
      duplicateInFile += 1; // dedupe within the file
      continue;
    }
    seen.add(c.timeSec);
    toInsert.push({
      instrumentId: instrument.id,
      timeframe: input.timeframe,
      openTime: new Date(c.timeSec * 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    });
  }

  if (toInsert.length === 0) {
    throw new Error("NO_VALID_ROWS");
  }

  // Existing openTimes (skip duplicates).
  const existing = await db.priceCandle.findMany({
    where: {
      instrumentId: instrument.id,
      timeframe: input.timeframe,
      openTime: { in: toInsert.map((c) => c.openTime) },
    },
    select: { openTime: true },
  });
  const existingSet = new Set(existing.map((e) => e.openTime.getTime()));
  const fresh = toInsert.filter((c) => !existingSet.has(c.openTime.getTime()));
  const skipped = duplicateInFile + (toInsert.length - fresh.length);

  // Chunked createMany (SQLite variable limits). Duplicates are already
  // filtered manually above — `skipDuplicates` is unsupported on SQLite.
  for (let i = 0; i < fresh.length; i += 500) {
    await db.priceCandle.createMany({
      data: fresh.slice(i, i + 500),
    });
  }

  // Budget prune: total candles for this instrument+timeframe across the user's
  // usable instruments — keep the newest CANDLE_USER_BUDGET rows.
  let pruned = 0;
  const total = await db.priceCandle.count({
    where: { instrumentId: instrument.id, timeframe: input.timeframe },
  });
  if (total > CANDLE_USER_BUDGET) {
    const excess = total - CANDLE_USER_BUDGET;
    const oldest = await db.priceCandle.findMany({
      where: { instrumentId: instrument.id, timeframe: input.timeframe },
      orderBy: { openTime: "asc" },
      take: excess,
      select: { id: true },
    });
    const res = await db.priceCandle.deleteMany({
      where: { id: { in: oldest.map((o) => o.id) } },
    });
    pruned = res.count;
  }

  // Trade-window prune: rows older than CANDLE_PRUNE_DAYS that don't fall
  // within ± CANDLE_TRADE_PAD_DAYS of one of the user's trades on this
  // instrument are deleted (keep the storage bounded to traded windows).
  const cutoff = new Date(Date.now() - CANDLE_PRUNE_DAYS * 86400_000);
  const trades = await db.trade.findMany({
    where: { userId, instrumentId: instrument.id },
    select: { entryTime: true, exitTime: true },
  });
  const keepWindows: Array<{ from: Date; to: Date }> = trades.map((t) => ({
    from: new Date(t.entryTime.getTime() - CANDLE_TRADE_PAD_DAYS * 86400_000),
    to: new Date(
      (t.exitTime ?? t.entryTime).getTime() + CANDLE_TRADE_PAD_DAYS * 86400_000
    ),
  }));
  const inKeepWindow = (d: Date): boolean =>
    keepWindows.some((w) => d >= w.from && d <= w.to);

  const oldRows = await db.priceCandle.findMany({
    where: {
      instrumentId: instrument.id,
      timeframe: input.timeframe,
      openTime: { lt: cutoff },
    },
    select: { id: true, openTime: true },
  });
  const removable = oldRows.filter((r) => !inKeepWindow(r.openTime));
  if (removable.length > 0) {
    const res = await db.priceCandle.deleteMany({
      where: { id: { in: removable.map((r) => r.id) } },
    });
    pruned += res.count;
  }

  const times = fresh.map((c) => c.openTime.getTime()).sort((a, b) => a - b);
  return {
    imported: fresh.length,
    skipped,
    invalid,
    pruned,
    timeframe: input.timeframe,
    firstTime: times.length > 0 ? new Date(times[0]).toISOString() : null,
    lastTime: times.length > 0 ? new Date(times[times.length - 1]).toISOString() : null,
  };
}

/** Candle coverage summary for one trade window (powers the fallback UI). */
export async function candleCoverageForTrade(
  userId: string,
  instrumentId: string,
  fromIso: string,
  toIso: string
): Promise<{ timeframes: string[]; count: number }> {
  const instrument = await resolveInstrumentUsable(userId, instrumentId);
  if (!instrument) return { timeframes: [], count: 0 };
  const groups = await db.priceCandle.groupBy({
    by: ["timeframe"],
    where: {
      instrumentId: instrument.id,
      openTime: { gte: new Date(fromIso), lte: new Date(toIso) },
    },
    _count: { _all: true },
  });
  return {
    timeframes: groups.map((g) => g.timeframe),
    count: groups.reduce((a, g) => a + g._count._all, 0),
  };
}

// ── Benchmark profiles (v2.5 M2 Phase 5) ─────────────────────────────────────

import type { BenchmarkInput } from "@/lib/validations/charts";

export interface BenchmarkProfileDTO {
  id: string;
  name: string;
  type: string;
  params: unknown;
  series: Array<{ date: string; value: number }> | null;
  createdAt: string;
}

function toBenchmarkDto(row: {
  id: string;
  name: string;
  type: string;
  params: string;
  seriesJson: string | null;
  createdAt: Date;
}): BenchmarkProfileDTO {
  let params: unknown = {};
  let series: Array<{ date: string; value: number }> | null = null;
  try {
    params = JSON.parse(row.params);
  } catch {
    params = {};
  }
  if (row.seriesJson) {
    try {
      series = JSON.parse(row.seriesJson);
    } catch {
      series = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    params,
    series,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBenchmarks(
  userId: string
): Promise<BenchmarkProfileDTO[]> {
  const rows = await db.benchmarkProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toBenchmarkDto);
}

export async function createBenchmark(
  userId: string,
  input: BenchmarkInput
): Promise<BenchmarkProfileDTO> {
  const row = await db.benchmarkProfile.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      params: JSON.stringify(input.params),
      seriesJson: input.series ? JSON.stringify(input.series) : null,
    },
  });
  return toBenchmarkDto(row);
}

export async function deleteBenchmark(
  userId: string,
  id: string
): Promise<boolean> {
  const res = await db.benchmarkProfile.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

// ── Annotations (v2.5 M2 Phase 6) ────────────────────────────────────────────

import type {
  AnnotationInput,
  AnnotationPatch,
} from "@/lib/validations/charts";
import { annotationInputSchema } from "@/lib/validations/charts";

export interface AnnotationDTO {
  id: string;
  date: string;
  endDate: string | null;
  label: string;
  note: string | null;
  kind: string;
  color: string | null;
  scope: string;
  accountId: string | null;
  strategyId: string | null;
}

function toAnnotationDto(row: {
  id: string;
  date: Date;
  endDate: Date | null;
  label: string;
  note: string | null;
  kind: string;
  color: string | null;
  scope: string;
  accountId: string | null;
  strategyId: string | null;
}): AnnotationDTO {
  return {
    id: row.id,
    date: row.date.toISOString(),
    endDate: row.endDate != null ? row.endDate.toISOString() : null,
    label: row.label,
    note: row.note,
    kind: row.kind,
    color: row.color,
    scope: row.scope,
    accountId: row.accountId,
    strategyId: row.strategyId,
  };
}

export async function listAnnotations(userId: string): Promise<AnnotationDTO[]> {
  const rows = await db.chartAnnotation.findMany({
    where: { userId },
    orderBy: { date: "asc" },
  });
  return rows.map(toAnnotationDto);
}

export async function createAnnotation(
  userId: string,
  input: AnnotationInput
): Promise<AnnotationDTO> {
  // Cross-field rules were validated by annotationInputSchema — re-derive
  // the stored scope targets from the scope itself.
  const row = await db.chartAnnotation.create({
    data: {
      userId,
      date: new Date(input.date),
      endDate: input.endDate != null ? new Date(input.endDate) : null,
      label: input.label,
      note: input.note ?? null,
      kind: input.kind,
      color: input.color ?? null,
      scope: input.scope,
      accountId: input.scope === "ACCOUNT" ? (input.accountId ?? null) : null,
      strategyId: input.scope === "STRATEGY" ? (input.strategyId ?? null) : null,
    },
  });
  return toAnnotationDto(row);
}

export async function updateAnnotation(
  userId: string,
  id: string,
  patch: AnnotationPatch
): Promise<AnnotationDTO | null> {
  const existing = await db.chartAnnotation.findFirst({ where: { id, userId } });
  if (!existing) return null;
  // Merge the patch over the stored row and revalidate the FULL object —
  // cross-field scope rules must hold after the merge (Zod v4 forbids
  // .partial() after refinements).
  const merged: AnnotationInput = {
    date: patch.date ?? existing.date.toISOString(),
    endDate:
      patch.endDate !== undefined
        ? (patch.endDate ?? null)
        : (existing.endDate != null ? existing.endDate.toISOString() : null),
    label: patch.label ?? existing.label,
    note: patch.note !== undefined ? (patch.note ?? null) : existing.note,
    kind: patch.kind ?? (existing.kind as AnnotationInput["kind"]),
    color: patch.color !== undefined ? (patch.color ?? null) : existing.color,
    scope: patch.scope ?? (existing.scope as AnnotationInput["scope"]),
    accountId:
      patch.accountId !== undefined
        ? (patch.accountId ?? null)
        : existing.accountId,
    strategyId:
      patch.strategyId !== undefined
        ? (patch.strategyId ?? null)
        : existing.strategyId,
  };
  const parsed = annotationInputSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error("ANNOTATION_INVALID");
  }
  const row = await db.chartAnnotation.update({
    where: { id },
    data: {
      date: new Date(parsed.data.date),
      endDate: parsed.data.endDate != null ? new Date(parsed.data.endDate) : null,
      label: parsed.data.label,
      note: parsed.data.note ?? null,
      kind: parsed.data.kind,
      color: parsed.data.color ?? null,
      scope: parsed.data.scope,
      accountId: parsed.data.scope === "ACCOUNT" ? (parsed.data.accountId ?? null) : null,
      strategyId: parsed.data.scope === "STRATEGY" ? (parsed.data.strategyId ?? null) : null,
    },
  });
  return toAnnotationDto(row);
}

export async function deleteAnnotation(
  userId: string,
  id: string
): Promise<boolean> {
  const res = await db.chartAnnotation.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
