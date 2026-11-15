/**
 * v2.5 Module 8 — Trading-day definition (§3.4).
 *
 * ONE utility decides which "day" an instant belongs to, for daily stats,
 * calendars, streaks, journal linkage and daily-loss rules:
 *
 *  - MIDNIGHT_LOCAL   day = calendar date in the user's timezone (default —
 *                     preserves the pre-Module-8 behaviour exactly);
 *  - NEW_YORK_CLOSE   day D = (17:00 America/New_York on D−1, 17:00 on D];
 *  - CUSTOM           day D = (rollover time on D−1, rollover time on D] in
 *                     a chosen IANA zone.
 *
 * All conversions go through the Intl tz database (DST-safe). The v2 prop
 * firm day reset keeps its own rule-set timezone — documented relation:
 * prop firms define their daily reset independently, so prop-status keeps
 * using its configured zone; when the user picks NY_CLOSE here the two
 * conventions usually coincide (see README "Privacy & accessibility").
 */
import { zonedClock, zonedDate, zonedParts } from "./zones";

export type TradingDayRolloverMode =
  | "MIDNIGHT_LOCAL"
  | "NEW_YORK_CLOSE"
  | "CUSTOM";

export interface TradingDaySettings {
  mode: TradingDayRolloverMode;
  /** "HH:MM" — required for CUSTOM, ignored otherwise. */
  rolloverTime?: string | null;
  /** IANA zone — required for CUSTOM, ignored otherwise. */
  rolloverTimezone?: string | null;
}

export const DEFAULT_TRADING_DAY: TradingDaySettings = {
  mode: "MIDNIGHT_LOCAL",
};

export const NEW_YORK_CLOSE_ZONE = "America/New_York";
/** 17:00 New York = the forex market close (weekly close: Friday 17:00). */
export const NEW_YORK_CLOSE_CLOCK = "17:00";

/** Parses a "HH:MM" wall-clock string → minutes since midnight (null if bad). */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

/** Adds `days` to a YYYY-MM-DD key (UTC arithmetic — zones never matter here). */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

function rolloverDayFor(
  instant: Date,
  zone: string,
  rolloverMinutes: number
): string {
  const date = zonedDate(instant, zone);
  const clock = zonedClock(instant, zone);
  const [h, m] = clock.split(":").map(Number);
  const minutes = h * 60 + m;
  // At or after the rollover instant → the trading day is the NEXT calendar
  // day (day D ends at the rollover time ON day D). Midnight (00:00) is the
  // plain calendar date.
  if (rolloverMinutes === 0) return date;
  return minutes >= rolloverMinutes ? addDaysToDayKey(date, 1) : date;
}

/**
 * The trading day (YYYY-MM-DD) containing `instantUtc` for the given user
 * timezone and rollover settings. Falls back to the calendar date whenever
 * the CUSTOM config is incomplete or the zone is invalid — never throws.
 */
export function getTradingDay(
  instantUtc: Date,
  timezone: string,
  settings: TradingDaySettings
): string {
  if (settings.mode === "NEW_YORK_CLOSE") {
    const rollover = parseClock(NEW_YORK_CLOSE_CLOCK) ?? 17 * 60;
    return rolloverDayFor(instantUtc, NEW_YORK_CLOSE_ZONE, rollover);
  }
  if (settings.mode === "CUSTOM") {
    const rollover = parseClock(settings.rolloverTime);
    const zone = settings.rolloverTimezone;
    if (rollover == null || !zone) {
      return zonedDate(instantUtc, timezone);
    }
    return rolloverDayFor(instantUtc, zone, rollover);
  }
  return zonedDate(instantUtc, timezone);
}

/** Trading-day key of an ISO string (convenience wrapper). */
export function getTradingDayOfIso(
  iso: string,
  timezone: string,
  settings: TradingDaySettings
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return getTradingDay(d, timezone, settings);
}

/**
 * The UTC instant at which trading day `dayKey` STARTS (its lower bound,
 * exclusive). Used to recompute day-bucketed aggregates and calendar ranges.
 */
export function tradingDayStartUtc(
  dayKey: string,
  timezone: string,
  settings: TradingDaySettings
): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d, 12, 0, 0); // noon UTC of the key date
  // NY_CLOSE / CUSTOM: the day starts at the rollover instant the evening
  // before (up to ~24h before the key date's noon when the rollover is
  // early). Search a 60h window from 48h before noon to 12h after for the
  // first instant whose trading day equals dayKey, then refine to the minute.
  if (settings.mode !== "MIDNIGHT_LOCAL") {
    let lo = base - 48 * 3600 * 1000;
    const hi = base + 12 * 3600 * 1000;
    let start = hi;
    for (let t = lo; t <= hi; t += 15 * 60 * 1000) {
      if (getTradingDay(new Date(t), timezone, settings) === dayKey) {
        start = t;
        break;
      }
    }
    // Refine backwards to the minute (all tz offsets are minute-aligned).
    let t = start - 15 * 60 * 1000;
    while (
      t < start &&
      getTradingDay(new Date(t), timezone, settings) !== dayKey
    ) {
      t += 60 * 1000;
    }
    return new Date(t);
  }
  // MIDNIGHT_LOCAL: 00:00 in the user's zone. Find the UTC instant whose
  // zoned parts are the key date at 00:00 — derive from the offset at noon.
  const offsetNoon = offsetOf(timezone, new Date(base));
  return new Date(base - offsetNoon * 60 * 1000 - 12 * 3600 * 1000);
}

function offsetOf(tz: string, instant: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value;
    const match = parts ? /GMT([+\-\u2212])?(\d{1,2})(?::(\d{2}))?/.exec(parts) : null;
    if (!match) return 0;
    const sign = match[1] === "-" || match[1] === "\u2212" ? -1 : 1;
    return sign * (Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

/** Wall-clock label of the rollover for settings UI, e.g. "17:00 (New York)". */
export function rolloverLabel(settings: TradingDaySettings): string {
  switch (settings.mode) {
    case "NEW_YORK_CLOSE":
      return "17:00 America/New_York";
    case "CUSTOM":
      return `${settings.rolloverTime ?? "00:00"} ${settings.rolloverTimezone ?? ""}`.trim();
    default:
      return "00:00 local";
  }
}

/** True when the trading-day parts are needed for hour-of-day breakdowns. */
export function zonedHourIn(instant: Date, tz: string): number {
  return zonedParts(instant, tz).hour;
}
