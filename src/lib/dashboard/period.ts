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
 */
import type {
  GlobalFilter,
  PeriodOverride,
  PeriodPreset,
  ResolvedPeriod,
} from "./types";

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

function presetFrom(preset: PeriodPreset, timezone: string, now: Date): string | null {
  const today = localDateInTz(now, timezone);
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
function presetLengthDays(
  preset: PeriodPreset,
  timezone: string,
  now: Date
): number {
  const today = localDateInTz(now, timezone);
  switch (preset) {
    case "today":
      return 1;
    case "week":
      return 7;
    case "month": {
      const from = presetFrom(preset, timezone, now)!;
      return daysBetween(from, addDays(today, 1));
    }
    case "last30":
      return 30;
    case "last90":
      return 90;
    case "ytd":
      return daysBetween(presetFrom(preset, timezone, now)!, addDays(today, 1));
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
 */
export function resolvePeriod(
  global: GlobalFilter,
  override: PeriodOverride | null,
  timezone: string,
  now: Date = new Date()
): ResolvedPeriod {
  const mode = override?.mode ?? "INHERIT";

  if (mode === "INHERIT" || mode === "PRESET") {
    const preset: PeriodPreset =
      mode === "PRESET" ? (override?.preset ?? global.preset) : global.preset;
    const from = presetFrom(preset, timezone, now);
    const compare =
      override?.compareToPrevious && from != null
        ? (() => {
            const len = presetLengthDays(preset, timezone, now);
            return len > 0 ? addDays(from, -len) : null;
          })()
        : null;
    return {
      from: from != null ? localDayToUtcInstant(from, timezone).toISOString() : null,
      lastTrades: null,
      compareFrom:
        compare != null
          ? localDayToUtcInstant(compare, timezone).toISOString()
          : null,
      labelKey: preset,
    };
  }

  if (mode === "ROLLING_DAYS") {
    const days = Math.min(365, Math.max(1, Math.floor(override?.rollingDays ?? 30)));
    const today = localDateInTz(now, timezone);
    const from = addDays(today, -(days - 1));
    const compare = override?.compareToPrevious ? addDays(from, -days) : null;
    return {
      from: localDayToUtcInstant(from, timezone).toISOString(),
      lastTrades: null,
      compareFrom:
        compare != null
          ? localDayToUtcInstant(compare, timezone).toISOString()
          : null,
      labelKey: "rollingDays",
    };
  }

  if (mode === "ROLLING_TRADES") {
    const n = Math.min(1000, Math.max(1, Math.floor(override?.rollingTrades ?? 20)));
    // The global preset still bounds the dataset; the tail N trades are kept.
    const from = presetFrom(global.preset, timezone, now);
    return {
      from: from != null ? localDayToUtcInstant(from, timezone).toISOString() : null,
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
  const fromInstant = fromDay
    ? localDayToUtcInstant(fromDay, timezone).toISOString()
    : null;
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
    compareFrom:
      compare != null
        ? localDayToUtcInstant(compare, timezone).toISOString()
        : null,
    labelKey: "custom",
  };
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
