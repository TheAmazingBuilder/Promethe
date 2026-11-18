/**
 * Dashboard module — period resolution (v2.5 Module 1, spec §4.7).
 *
 * Pure function: global filter + per-widget override + user timezone + now
 * → a ResolvedPeriod (ISO lower bound / rolling trades / comparison window).
 *
 * Calendar semantics (all in the USER's timezone, matching calendar.ts):
 *  - "week" starts Monday 00:00 local;
 *  - "today" is the local calendar day;
 *  - month starts on day 1 local;
 *  - rolling N days = N local calendar days back from today inclusive;
 *  - comparisons span the identical duration immediately before the period.
 *
 * v2.5 Module 8 — "today" (and every window anchored on it) follows the
 * user's TRADING day when `tradingDay` is provided: the window then starts
 * at tradingDayStartUtc(from) instead of local midnight, so a NY-close
 * trade at 18:00 New York still belongs to "today". Default (no settings)
 * is MIDNIGHT_LOCAL — the previous behaviour, exactly.
 */
import type {
  GlobalFilter,
  PeriodOverride,
  PeriodPreset,
  ResolvedPeriod,
} from "./types";
import {
  DEFAULT_TRADING_DAY,
  getTradingDay,
  tradingDayStartUtc,
  type TradingDaySettings,
} from "@/lib/time/trading-day";

/** Local calendar day (YYYY-MM-DD) of an instant in `timezone`. */
function localDateInTz(date: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    // Invalid timezone — fall back to UTC.
    return date.toISOString().slice(0, 10);
  }
}

/** (year, month, day) → UTC instant of that LOCAL day's MIDNIGHT. */
function localDayToUtcInstant(isoDay: string, timezone: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number);
  const midnightUtcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Iterate the zone offset around local midnight (handles DST edges).
  let guess = new Date(
    midnightUtcGuess -
      zoneOffsetMinutes(new Date(midnightUtcGuess), timezone) * 60_000
  );
  for (let i = 0; i < 2; i++) {
    const offsetMin = zoneOffsetMinutes(guess, timezone);
    guess = new Date(midnightUtcGuess - offsetMin * 60_000);
  }
  return guess;
}

/** Zone offset (minutes east of UTC) of an instant - 0 on invalid zones. */
function zoneOffsetMinutes(date: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const name = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")
      ?.value;
    // "GMT+05:30" | "GMT-04:00" | "GMT"
    const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return 0;
  }
}

function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Monday of the local week containing isoDay. */
function startOfWeek(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  const backToMonday = (dow + 6) % 7;
  return addDays(isoDay, -backToMonday);
}

function presetFrom(
  preset: PeriodPreset,
  today: string
): string | null {
  switch (preset) {
    case "today":
      return today;
    case "week":
      return startOfWeek(today);
    case "month":
      return `${today.slice(0, 7)}-01`;
    case "last30":
      return addDays(today, -29);
    case "last90":
      return addDays(today, -89);
    case "ytd":
      return `${today.slice(0, 4)}-01-01`;
    case "all":
      return null;
  }
}

/** Duration (in local days) of a preset window - for comparison periods. */
function presetLengthDays(preset: PeriodPreset, today: string): number {
  switch (preset) {
    case "today":
      return 1;
    case "week":
      return 7;
    case "month": {
      const from = presetFrom(preset, today)!;
      return daysBetween(from, addDays(today, 1));
    }
    case "last30":
      return 30;
    case "last90":
      return 90;
    case "ytd":
      return daysBetween(presetFrom(preset, today)!, addDays(today, 1));
    case "all":
      return 0;
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the effective period of one widget.
 *
 * @param global   the dashboard global filter (preset + account)
 * @param override the widget's period override (null = inherit)
 * @param timezone user IANA timezone (calendar semantics)
 * @param now      reference instant (injectable for tests)
 * @param tradingDay user trading-day setting (default MIDNIGHT_LOCAL —
 *                 the previous behaviour, exactly)
 */
export function resolvePeriod(
  global: GlobalFilter,
  override: PeriodOverride | null,
  timezone: string,
  now: Date = new Date(),
  tradingDay: TradingDaySettings = DEFAULT_TRADING_DAY
): ResolvedPeriod {
  const mode = override?.mode ?? "INHERIT";
  // "Today" is the TRADING day: with NY_CLOSE, 18:00 New York already
  // belongs to tomorrow's trading day, so the window starts at the
  // rollover instant, not at local midnight.
  const today = getTradingDay(now, timezone, tradingDay);
  const dayStart = (dayKey: string): string =>
    dayStartInstant(dayKey, timezone, tradingDay).toISOString();

  if (mode === "INHERIT" || mode === "PRESET") {
    const preset: PeriodPreset =
      mode === "PRESET" ? (override?.preset ?? global.preset) : global.preset;
    const from = presetFrom(preset, today);
    const compare =
      override?.compareToPrevious && from != null
        ? (() => {
            const len = presetLengthDays(preset, today);
            return len > 0 ? addDays(from, -len) : null;
          })()
        : null;
    return {
      from: from != null ? dayStart(from) : null,
      lastTrades: null,
      compareFrom: compare != null ? dayStart(compare) : null,
      labelKey: preset,
    };
  }

  if (mode === "ROLLING_DAYS") {
    const days = Math.min(365, Math.max(1, Math.floor(override?.rollingDays ?? 30)));
    const from = addDays(today, -(days - 1));
    const compare = override?.compareToPrevious ? addDays(from, -days) : null;
    return {
      from: dayStart(from),
      lastTrades: null,
      compareFrom: compare != null ? dayStart(compare) : null,
      labelKey: "rollingDays",
    };
  }

  if (mode === "ROLLING_TRADES") {
    const n = Math.min(1000, Math.max(1, Math.floor(override?.rollingTrades ?? 20)));
    // The global preset still bounds the dataset; the tail N trades are kept.
    const from = presetFrom(global.preset, today);
    return {
      from: from != null ? dayStart(from) : null,
      lastTrades: n,
      compareFrom: null,
      labelKey: "rollingTrades",
    };
  }

  // CUSTOM
  const fromDay = ISO_DAY_RE.test(override?.customFrom ?? "")
    ? (override!.customFrom as string)
    : null;
  const toDay = ISO_DAY_RE.test(override?.customTo ?? "")
    ? (override!.customTo as string)
    : null;
  const fromInstant = fromDay ? dayStart(fromDay) : null;
  const compare =
    override?.compareToPrevious && fromDay && toDay
      ? (() => {
          const len = Math.max(1, daysBetween(fromDay, addDays(toDay, 1)));
          return addDays(fromDay, -len);
        })()
      : null;
  return {
    from: fromInstant,
    lastTrades: null,
    compareFrom: compare != null ? dayStart(compare) : null,
    labelKey: "custom",
  };
}

/**
 * UTC instant at which `dayKey` starts: local midnight for MIDNIGHT_LOCAL
 * (the previous behaviour, DST-safe via localDayToUtcInstant), the rollover
 * instant for NY_CLOSE / CUSTOM.
 */
function dayStartInstant(
  dayKey: string,
  timezone: string,
  tradingDay: TradingDaySettings
): Date {
  if (tradingDay.mode === "MIDNIGHT_LOCAL") {
    return localDayToUtcInstant(dayKey, timezone);
  }
  return tradingDayStartUtc(dayKey, timezone, tradingDay);
}

/** Filter trades by a resolved period (exit-time attribution). */
export function applyPeriod<T extends { exitTime: string }>(
  trades: T[],
  period: ResolvedPeriod
): T[] {
  let out = trades;
  if (period.from != null) {
    out = out.filter((t) => t.exitTime >= period.from!);
  }
  if (period.lastTrades != null && out.length > period.lastTrades) {
    // exitTime ascending, keep the tail
    const sorted = [...out].sort((a, b) =>
      a.exitTime < b.exitTime ? -1 : a.exitTime > b.exitTime ? 1 : 0
    );
    const keep = new Set(sorted.slice(-period.lastTrades).map((t) => t));
    out = out.filter((t) => keep.has(t));
  }
  return out;
}

/** Trades of the comparison window (exit-time attribution). */
export function applyComparePeriod<T extends { exitTime: string }>(
  trades: T[],
  period: ResolvedPeriod
): T[] {
  if (period.compareFrom == null || period.from == null) return [];
  return trades.filter(
    (t) => t.exitTime >= period.compareFrom! && t.exitTime < period.from!
  );
}
