/**
 * Economic calendar - provider-agnostic core (lot 10, roadmap section 12).
 *
 * Pure functions only (no DB, no fetch): dedupe key, category
 * classification, the FRED curated release map, the cross-source merge
 * rule, and DST-safe wall-time conversion. Providers live in fred.ts and
 * forexfactory.ts; persistence lives in src/server/economic-calendar.ts.
 *
 * Data honesty rules (enforced here, not in the UI):
 * - No figure is ever invented. A missing value stays null.
 * - FRED has no forecast and no impact rating: those stay null on FRED
 *   events. ForexFactory has no actual value: it stays null there.
 * - One row per real-world event, keyed by dedupeKey. A manual event is
 *   authoritative and sync never touches it.
 */

import { zonedParts } from "@/lib/time/zones";

/** Provider sources for a stored event. */
export type EconomicEventSource = "FRED" | "FOREXFACTORY" | "MANUAL";

/** Impact levels the app stores. Null means "the source rates nothing". */
export type EconomicImpact = "LOW" | "MEDIUM" | "HIGH";

export const IMPACT_ORDER: Record<Exclude<EconomicImpact, null>, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * True when an event passes a minimum-impact filter. Unrated events (null
 * impact) always pass: their importance is unknown, hiding them would drop
 * real announcements from the watchlist. The UI badges them "Unrated".
 */
export function passesMinImpact(impact: EconomicImpact | null, minImpact: string): boolean {
  if (impact == null) return true;
  const wanted = IMPACT_ORDER[minImpact as EconomicImpact];
  if (wanted == null) return true;
  return IMPACT_ORDER[impact] >= wanted;
}

/** Event categories stored on EconomicEvent.category. */
export type EconomicCategory =
  | "NFP"
  | "CPI"
  | "FOMC"
  | "PPI"
  | "GDP"
  | "PMI"
  | "RETAIL_SALES"
  | "RATE_DECISION"
  | "SPEECH"
  | "OTHER";

/** One event as a provider returns it, before persistence. */
export interface NormalizedEconomicEvent {
  /** Stable per-source id (FRED release id + date, ForexFactory dedupe key). */
  externalId: string;
  title: string;
  currency: string;
  country: string | null;
  impact: EconomicImpact | null;
  category: EconomicCategory;
  /** Scheduled instant, UTC. */
  scheduledAt: Date;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  unit: string | null;
}

/** Per-source last update, stored as JSON on EconomicEvent.sourceMeta. */
export interface SourceMetaEntry {
  updatedAt: string;
  externalId: string;
}

export type SourceMeta = Partial<Record<EconomicEventSource, SourceMetaEntry>>;

export function parseSourceMeta(raw: string | null): SourceMeta {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SourceMeta;
    }
  } catch {
    // Corrupt meta never blocks the event: treat it as absent.
  }
  return {};
}

/** Lowercase slug: runs of non-alphanumerics become one hyphen, edges trimmed. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** UTC calendar day of an instant, YYYY-MM-DD. */
export function utcDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Cross-source merge key: slug(title) | UTC date | currency.
 *
 * The third component is the currency, NOT the country: the two
 * providers express geography differently (FRED uses the ISO country
 * code "US", ForexFactory's `country` field holds the currency code
 * "USD"), so keying on the country would split the same real-world
 * release into two rows. The title slug disambiguates releases that
 * share a currency (e.g. "German CPI m/m" vs "French CPI m/m").
 * Two bare same-title releases in the same currency on the same day
 * would still collide: a manual duplicate is refused with 409.
 * The same rule is mirrored in the migration SQL backfill
 * (prisma/migrations/20261125120000_economic_calendar_sources).
 */
export function buildDedupeKey(
  title: string,
  scheduledAt: Date,
  currency: string,
): string {
  return `${slugifyTitle(title)}|${utcDateOf(scheduledAt)}|${currency}`;
}

/**
 * Wall-clock time in an IANA zone to a UTC instant. DST-safe via Intl:
 * the zone offset is resolved at the instant itself (two passes, so the
 * fall-back / spring-forward edges land on the right side). 08:30 ET never
 * falls inside a DST gap, so no ambiguous-hour handling is needed here.
 */
export function zonedTimeToUtc(
  date: string,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const parts = zonedParts(new Date(guess), tz);
    const partsAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += wallAsUtc - partsAsUtc;
  }
  return new Date(guess);
}

// ── Category classification ──────────────────────────────────────────────────

/** Ordered keyword rules: first match wins. Titles are lowercased first. */
const CATEGORY_RULES: Array<{ test: RegExp; category: EconomicCategory }> = [
  { test: /fomc/, category: "FOMC" },
  { test: /non-?farm|employment change|unemployment|jobless|jolts|payrolls/, category: "NFP" },
  { test: /consumer price|\bcpi\b/, category: "CPI" },
  { test: /producer price|\bppis?\b|\bppp\b/, category: "PPI" },
  { test: /gross domestic product|\bgdp\b/, category: "GDP" },
  { test: /purchasing managers|\bpmi\b|ism manufacturing|ism services/, category: "PMI" },
  { test: /retail sales/, category: "RETAIL_SALES" },
  { test: /rate decision|interest rate|monetary policy/, category: "RATE_DECISION" },
  { test: /speaks|speech|testif/, category: "SPEECH" },
];

export function classifyCategory(title: string): EconomicCategory {
  const lower = title.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(lower)) return rule.category;
  }
  return "OTHER";
}

// ── FRED curated releases ────────────────────────────────────────────────────

/**
 * FRED publishes every release on its calendar (hundreds, most of them
 * noise for a trader). Only releases matching this curated map are kept.
 * Each entry maps a FRED release-name keyword to the canonical title the
 * app stores, so a FRED event merges with the same ForexFactory event:
 * FRED "Consumer Price Index" and ForexFactory "CPI m/m" are the same
 * real-world release, and share one dedupe key. Releases outside this map
 * are dropped, never stored.
 */
export interface FredReleaseMapping {
  /** Substring of the FRED release name, lowercased. */
  keyword: string;
  /** Canonical title, matching the ForexFactory headline variant. */
  title: string;
  category: EconomicCategory;
}

export const FRED_RELEASE_MAP: FredReleaseMapping[] = [
  { keyword: "consumer price index", title: "CPI m/m", category: "CPI" },
  { keyword: "employment situation", title: "Non-Farm Employment Change", category: "NFP" },
  { keyword: "gross domestic product", title: "GDP q/q", category: "GDP" },
  { keyword: "producer price index", title: "PPI m/m", category: "PPI" },
  { keyword: "advance monthly sales for retail", title: "Retail Sales m/m", category: "RETAIL_SALES" },
  { keyword: "personal income and outlays", title: "Core PCE Price Index m/m", category: "OTHER" },
  { keyword: "new residential construction", title: "Housing Starts", category: "OTHER" },
  { keyword: "industrial production and capacity", title: "Industrial Production m/m", category: "OTHER" },
  { keyword: "international trade in goods and services", title: "Trade Balance", category: "OTHER" },
  { keyword: "job openings and labor turnover", title: "JOLTS Job Openings", category: "NFP" },
  { keyword: "unemployment insurance weekly claims", title: "Unemployment Claims", category: "NFP" },
  { keyword: "consumer sentiment", title: "Prelim UoM Consumer Sentiment", category: "OTHER" },
  { keyword: "manufacturing ism report", title: "ISM Manufacturing PMI", category: "PMI" },
  { keyword: "services ism report", title: "ISM Services PMI", category: "PMI" },
  { keyword: "construction spending", title: "Construction Spending m/m", category: "OTHER" },
  { keyword: "new home sales", title: "New Home Sales", category: "OTHER" },
  { keyword: "existing home sales", title: "Existing Home Sales", category: "OTHER" },
  { keyword: "durable goods", title: "Durable Goods Orders m/m", category: "OTHER" },
  { keyword: "beige book", title: "Beige Book", category: "OTHER" },
];

export function mapFredRelease(releaseName: string): FredReleaseMapping | null {
  const lower = releaseName.toLowerCase();
  return FRED_RELEASE_MAP.find((entry) => lower.includes(entry.keyword)) ?? null;
}

/** An event row is stale when its source has not refreshed it for 7 days. */
export const EVENT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A source is stale when its last successful sync is over 24 h old. */
export const SOURCE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Manual refreshes are throttled per source (5 min) unless forced. */
export const SYNC_THROTTLE_MS = 5 * 60 * 1000;
/** FRED publishes dates, not times. US macro releases land at 08:30 ET. */
export const FRED_RELEASE_HOUR_ET = 8;
export const FRED_RELEASE_MINUTE_ET = 30;
export const FRED_TIMEZONE = "America/New_York";

/** Max FRED releases kept per sync (FRED allows 120 calls/min). */
export const FRED_MAX_RELEASES_PER_SYNC = 40;

// ── Cross-source merge ───────────────────────────────────────────────────────

/**
 * Merge rule (lot 10), applied when a provider event arrives for a
 * dedupeKey that already has a row. Precedence, per field:
 * - scheduledAt: the DATE comes from FRED (official schedule); the
 *   time-of-day comes from ForexFactory when it has one, else 08:30 ET.
 * - actual: FRED wins (official series value). ForexFactory has no actual.
 * - forecast: ForexFactory wins (FRED has no forecast).
 * - previous: FRED wins (official series), ForexFactory fills when absent.
 * - impact: ForexFactory wins (FRED rates nothing).
 * - title / category / currency / country: identical by construction once
 *   the keys match, so the incoming values are kept as-is.
 * - source: the highest-precedence contributing source (FRED over
 *   ForexFactory). sourceMeta records every contributing source.
 * Manual rows are never passed here: the sync skips them before merging.
 */
export function mergeProviderEvent(
  existing: {
    source: string;
    scheduledAt: Date;
    actual: string | null;
    forecast: string | null;
    previous: string | null;
    impact: EconomicImpact | null;
    sourceMeta: SourceMeta;
  },
  incoming: NormalizedEconomicEvent & { source: EconomicEventSource },
  now: Date,
): {
  scheduledAt: Date;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  impact: EconomicImpact | null;
  source: EconomicEventSource;
  sourceMeta: SourceMeta;
} {
  const incomingIsFred = incoming.source === "FRED";
  const existingIsFred = existing.source === "FRED";

  // Scheduled instant. The official FRED date wins when the two sources
  // disagree on the day; on the same day the ForexFactory instant wins
  // because it carries the exact time (FRED publishes dates, not times,
  // and its 08:30 ET is an assumption). Same-source re-syncs keep the
  // fresh incoming instant.
  const existingDay = utcDateOf(existing.scheduledAt);
  const incomingDay = utcDateOf(incoming.scheduledAt);
  let scheduledAt: Date;
  if (existingDay !== incomingDay) {
    scheduledAt = existingIsFred && !incomingIsFred ? existing.scheduledAt : incoming.scheduledAt;
  } else {
    scheduledAt = !existingIsFred && incomingIsFred ? existing.scheduledAt : incoming.scheduledAt;
  }

  const actual = incomingIsFred
    ? (incoming.actual ?? existing.actual)
    : (existing.actual ?? incoming.actual);
  const forecast = incomingIsFred
    ? (existing.forecast ?? incoming.forecast)
    : (incoming.forecast ?? existing.forecast);
  const previous = incomingIsFred
    ? (incoming.previous ?? existing.previous)
    : (existing.previous ?? incoming.previous);
  const impact = incomingIsFred
    ? (existing.impact ?? incoming.impact)
    : (incoming.impact ?? existing.impact);
  const source: EconomicEventSource = existingIsFred || incomingIsFred ? "FRED" : "FOREXFACTORY";

  const sourceMeta: SourceMeta = {
    ...existing.sourceMeta,
    [incoming.source]: {
      updatedAt: now.toISOString(),
      externalId: incoming.externalId,
    },
  };

  return { scheduledAt, actual, forecast, previous, impact, source, sourceMeta };
}
