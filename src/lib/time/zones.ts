/**
 * v2.5 Module 8 — Timezone utilities (client & server safe).
 *
 * Built exclusively on IANA zones + the Intl API (like the existing
 * localDateInTz) — never hand-rolled offsets, always DST-safe because the
 * tz database does the arithmetic. date-fns stays for calendar math on plain
 * Date objects; every zone conversion goes through here.
 */

/** True when `tz` is a valid IANA zone name (Intl-accepted). */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday (local)
}

/**
 * Wall-clock parts of `instant` in `tz` (DST-safe, via Intl formatToParts).
 * Falls back to UTC parts when `tz` is invalid.
 */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(instant);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(instant);
  }
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // hour12:false can yield "24" for midnight in some environments — normalize.
  const hour = Number(map.hour) % 24;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    map.weekday ?? ""
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayIndex >= 0 ? weekdayIndex : 0,
  };
}

/** ISO date (YYYY-MM-DD) of `instant` in `tz`. */
export function zonedDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" wall-clock time of `instant` in `tz`. */
export function zonedClock(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * UTC offset of `tz` at `instant`, in minutes east of UTC (e.g. Paris summer
 * = +120, New York winter = −300). Computed from Intl's longOffset label —
 * the tz database handles DST, including the exact transition instants.
 */
export function offsetMinutesOfTz(instant: Date, tz: string): number {
  let label = "";
  try {
    label = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  } catch {
    return 0;
  }
  // "GMT", "GMT+03:00", "GMT−05:30" (note: some engines print U+2212 or "-")
  const match = /GMT([+\-\u2212])?(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return 0;
  const sign = match[1] === "-" || match[1] === "\u2212" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

/**
 * Broker-server offset for the "New York close" convention (MT4/MT5 default):
 * GMT+2 while New York observes standard time, GMT+3 during US DST — i.e. a
 * constant 7-hour lead on New York local time so that server 00:00 = 17:00 NY.
 */
export function nyCloseBrokerOffsetMinutes(instant: Date): number {
  return offsetMinutesOfTz(instant, "America/New_York") + 420;
}

/** "GMT+3", "GMT−5:30" - human label for a fixed offset in minutes. */
export function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Day-of-week label index with configurable week start (0 = Sunday). */
export function weekdayIndexWithWeekStart(isoDate: string, weekStartsOn: number): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (dow - weekStartsOn + 7) % 7;
}

export type ClockFormat = "12H" | "24H" | "LOCALE";

/**
 * Formats a time-of-day honoring the user's 12H/24H/LOCALE preference.
 * English only (Phase 3): the LOCALE fallback is the 12H style.
 */
export function formatClock(
  hour: number,
  minute: number,
  format: ClockFormat,
  _locale: string
): string {
  const use12 = format === "12H" || format === "LOCALE";
  if (!use12) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Offset label of `tz` at `instant`, e.g. "GMT+2". */
export function offsetLabelOfTz(instant: Date, tz: string): string {
  return formatOffsetLabel(offsetMinutesOfTz(instant, tz));
}

/**
 * Common IANA timezones offered in the settings UI (profile timezone,
 * extra zones, rollover zone). The user's current zone is always offered
 * in addition when it is not in this list.
 */
export const COMMON_TIMEZONES: readonly string[] = [
  "UTC",
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Vancouver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Frankfurt",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Amsterdam",
  "Africa/Casablanca",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Moscow",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
