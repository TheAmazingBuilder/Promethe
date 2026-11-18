/**
 * v2.5 Module 5 - market-hours clock + session detection settings.
 *
 * Two related concepts share the MarketSessionSetting model:
 *  - DISPLAY sessions (Sydney, Tokyo, London, New York): IANA zones, local
 *    open/close hours, DST handled by Intl - used by the /tools clock.
 *  - DETECTION ranges (ASIAN, LONDON, OVERLAP, NEW_YORK, OTHER): the
 *    legacy UTC ranges that used to be hardcoded in src/lib/trading/session.ts.
 *    They are the defaults so existing trades keep their historical session;
 *    the user can edit them in the settings.
 *
 * All local-time math goes through Intl.DateTimeFormat with a timeZone, so
 * DST transitions are correct without a date library.
 */
import type { TradingSession } from "@/lib/trading/types";
import type { MarketSessionSettingEntry } from "./types";

export type { MarketSessionSettingEntry } from "./types";

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_DISPLAY_SESSIONS: MarketSessionSettingEntry[] = [
  {
    id: "default-sydney",
    name: "Sydney",
    kind: "DISPLAY",
    timezone: "Australia/Sydney",
    openTime: "07:00",
    closeTime: "16:00",
    activeDays: [1, 2, 3, 4, 5],
    enabled: true,
    sortOrder: 1,
  },
  {
    id: "default-tokyo",
    name: "Tokyo",
    kind: "DISPLAY",
    timezone: "Asia/Tokyo",
    openTime: "09:00",
    closeTime: "18:00",
    activeDays: [1, 2, 3, 4, 5],
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "default-london",
    name: "London",
    kind: "DISPLAY",
    timezone: "Europe/London",
    openTime: "08:00",
    closeTime: "16:30",
    activeDays: [1, 2, 3, 4, 5],
    enabled: true,
    sortOrder: 3,
  },
  {
    id: "default-newyork",
    name: "New York",
    kind: "DISPLAY",
    timezone: "America/New_York",
    openTime: "08:00",
    closeTime: "17:00",
    activeDays: [1, 2, 3, 4, 5],
    enabled: true,
    sortOrder: 4,
  },
];

/** Legacy UTC ranges, kept as detection defaults (session.ts history). */
export const DEFAULT_DETECTION_SETTINGS: MarketSessionSettingEntry[] = [
  { id: "default-det-asian", name: "ASIAN", kind: "DETECTION", timezone: "UTC", openTime: "00:00", closeTime: "07:00", activeDays: [1, 2, 3, 4, 5, 6, 7], enabled: true, sortOrder: 1 },
  { id: "default-det-london", name: "LONDON", kind: "DETECTION", timezone: "UTC", openTime: "07:00", closeTime: "12:00", activeDays: [1, 2, 3, 4, 5, 6, 7], enabled: true, sortOrder: 2 },
  { id: "default-det-overlap", name: "OVERLAP", kind: "DETECTION", timezone: "UTC", openTime: "12:00", closeTime: "16:00", activeDays: [1, 2, 3, 4, 5, 6, 7], enabled: true, sortOrder: 3 },
  { id: "default-det-ny", name: "NEW_YORK", kind: "DETECTION", timezone: "UTC", openTime: "16:00", closeTime: "21:00", activeDays: [1, 2, 3, 4, 5, 6, 7], enabled: true, sortOrder: 4 },
  { id: "default-det-other", name: "OTHER", kind: "DETECTION", timezone: "UTC", openTime: "21:00", closeTime: "24:00", activeDays: [1, 2, 3, 4, 5, 6, 7], enabled: true, sortOrder: 5 },
];

/** User rows win; missing entries fall back to the code defaults. Rows are
 * matched by (kind, name): the built-in rows are identified by name, and
 * any row the user saved for that session replaces its default. */
export function mergeSessionSettings(
  overrides: MarketSessionSettingEntry[]
): MarketSessionSettingEntry[] {
  const all = [...DEFAULT_DISPLAY_SESSIONS, ...DEFAULT_DETECTION_SETTINGS];
  return all.map(
    (d) =>
      overrides.find((o) => o.kind === d.kind && o.name === d.name) ?? d
  );
}

export function displaySessions(
  settings: MarketSessionSettingEntry[]
): MarketSessionSettingEntry[] {
  return settings
    .filter((s) => s.kind === "DISPLAY" && s.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function detectionSettings(
  settings: MarketSessionSettingEntry[]
): MarketSessionSettingEntry[] {
  return settings
    .filter((s) => s.kind === "DETECTION" && s.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ── IANA local-time helpers (DST-aware via Intl) ─────────────────────────────

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
}

export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = partsFormatter(timezone).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const weekdayStr = get("weekday");
  const weekday =
    { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayStr] ?? 1;
  // Intl can return hour "24" at midnight with h23 in some engines.
  const hour = Number(get("hour")) % 24;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday,
  };
}

/** Offset of `timezone` from UTC at `date`, in minutes. */
export function tzOffsetMinutes(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Instant (epoch ms) of a local wall-clock time in `timezone` on the UTC
 * day that contains `date` shifted by `dayOffset` days (in that zone).
 * Iterates twice: the offset can differ across a DST boundary.
 */
export function zonedTimeToUtc(
  date: Date,
  timezone: string,
  hhmm: string,
  dayOffset = 0
): number {
  const [hh, mm] = hhmm.split(":").map((v) => Number(v) || 0);
  const p = zonedParts(date, timezone);
  const baseDay = Date.UTC(p.year, p.month - 1, p.day + dayOffset, hh, mm);
  let guess = baseDay - tzOffsetMinutes(new Date(baseDay), timezone) * 60000;
  guess = baseDay - tzOffsetMinutes(new Date(guess), timezone) * 60000;
  return guess;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v) || 0);
  return h * 60 + m;
}

// ── Session status ───────────────────────────────────────────────────────────

export interface SessionStatus {
  setting: MarketSessionSettingEntry;
  open: boolean;
  /** True on a non-active day (week-end for Mon-Fri sessions). */
  weekend: boolean;
  /** Local time string in the session zone, e.g. "14:32". */
  localTime: string;
  /** ms until the next open (when closed) or close (when open). */
  nextChangeMs: number;
  nextChangeLabel: "opens" | "closes";
}

export function sessionStatus(
  setting: MarketSessionSettingEntry,
  now: Date
): SessionStatus {
  const p = zonedParts(now, setting.timezone);
  const localTime = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const activeToday = setting.activeDays.includes(p.weekday);
  const nowMin = p.hour * 60 + p.minute;
  const openMin = minutesOf(setting.openTime);
  const closeMin = minutesOf(setting.closeTime);
  const inHours = openMin <= nowMin && nowMin < closeMin;
  const open = activeToday && inHours;

  let nextChangeMs: number;
  let nextChangeLabel: "opens" | "closes";
  if (open) {
    nextChangeLabel = "closes";
    nextChangeMs = zonedTimeToUtc(now, setting.timezone, setting.closeTime) - now.getTime();
  } else if (activeToday && nowMin < openMin) {
    nextChangeLabel = "opens";
    nextChangeMs = zonedTimeToUtc(now, setting.timezone, setting.openTime) - now.getTime();
  } else {
    // Next active day at open time (scan up to 8 days ahead).
    nextChangeLabel = "opens";
    let found = zonedTimeToUtc(now, setting.timezone, setting.openTime, 1);
    for (let d = 1; d <= 8; d++) {
      const candidate = zonedTimeToUtc(now, setting.timezone, setting.openTime, d);
      const wd = zonedParts(new Date(candidate), setting.timezone).weekday;
      if (setting.activeDays.includes(wd)) {
        found = candidate;
        break;
      }
    }
    nextChangeMs = found - now.getTime();
  }
  return {
    setting,
    open,
    weekend: !activeToday,
    localTime,
    nextChangeMs: Math.max(0, nextChangeMs),
    nextChangeLabel,
  };
}

/** Names of the sessions currently open (for the overlap indicator). */
export function openSessionNames(
  statuses: SessionStatus[]
): string[] {
  return statuses.filter((s) => s.open).map((s) => s.setting.name);
}

/** True when the forex market is closed everywhere (week-end). */
export function isMarketWeekend(statuses: SessionStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => !s.open && s.weekend);
}

/** Countdown "02:14:33" from a millisecond duration. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ── Session detection from settings (replaces the hardcoded UTC ranges) ─────

/** Detect the trading session of a date using DETECTION settings. */
export function detectSessionFromSettings(
  date: Date,
  settings: MarketSessionSettingEntry[]
): TradingSession {
  const ranges = detectionSettings(settings);
  const match = (name: string): boolean => {
    const s = ranges.find((r) => r.name === name);
    if (!s) return false;
    const p = zonedParts(date, s.timezone);
    const nowMin = p.hour * 60 + p.minute;
    const openMin = minutesOf(s.openTime);
    // "24:00" close means end of day.
    const closeMin = s.closeTime === "24:00" ? 24 * 60 : minutesOf(s.closeTime);
    return openMin <= nowMin && nowMin < closeMin;
  };
  // Overlap has priority when ranges intersect (same as the legacy order).
  if (match("OVERLAP")) return "OVERLAP";
  if (match("LONDON")) return "LONDON";
  if (match("NEW_YORK")) return "NEW_YORK";
  if (match("ASIAN")) return "ASIAN";
  return "OTHER";
}
