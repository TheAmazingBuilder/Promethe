/**
 * v2.5 Module 8 — Broker server time (§3.4).
 *
 * Each Account describes its broker's server clock in one of three modes:
 *  - IANA         a plain timezone (e.g. "Europe/Riga");
 *  - FIXED_OFFSET a fixed UTC offset (some brokers, some crypto feeds);
 *  - NY_CLOSE     the MT4/MT5 "New York close" convention: GMT+2 in winter,
 *                 GMT+3 in summer, following US DST (server 00:00 = 17:00 NY).
 *
 * Used to display broker time alongside the user's time, to interpret
 * imported file timestamps / EA data, and by the "test with a sample
 * timestamp" tool in the time settings. DST transitions are handled by the
 * Intl tz database — never hand-rolled.
 */
import {
  formatClock,
  formatOffsetLabel,
  nyCloseBrokerOffsetMinutes,
  offsetMinutesOfTz,
  zonedClock,
  zonedDate,
  type ClockFormat,
} from "./zones";

export type BrokerTimezoneMode = "IANA" | "FIXED_OFFSET" | "NY_CLOSE";

export interface BrokerTimeConfig {
  mode: BrokerTimezoneMode;
  /** IANA zone when mode = IANA. */
  timezone?: string | null;
  /** Fixed UTC offset in minutes when mode = FIXED_OFFSET. */
  fixedOffsetMinutes?: number | null;
}

export const DEFAULT_BROKER_TIME: BrokerTimeConfig = { mode: "IANA", timezone: "UTC" };

/** Effective UTC offset (minutes east) of the broker clock at `instant`. */
export function brokerOffsetMinutes(
  config: BrokerTimeConfig,
  instant: Date
): number {
  switch (config.mode) {
    case "FIXED_OFFSET":
      return config.fixedOffsetMinutes ?? 0;
    case "NY_CLOSE":
      return nyCloseBrokerOffsetMinutes(instant);
    default:
      return config.timezone
        ? offsetMinutesOfTz(instant, config.timezone)
        : 0;
  }
}

/** Wall-clock "HH:MM" of `instant` on the broker server. */
export function brokerClock(config: BrokerTimeConfig, instant: Date): string {
  const offset = brokerOffsetMinutes(config, instant);
  const shifted = new Date(instant.getTime() + offset * 60 * 1000);
  return zonedClock(shifted, "UTC");
}

/** ISO date (YYYY-MM-DD) of `instant` on the broker server. */
export function brokerDate(config: BrokerTimeConfig, instant: Date): string {
  const offset = brokerOffsetMinutes(config, instant);
  const shifted = new Date(instant.getTime() + offset * 60 * 1000);
  return zonedDate(shifted, "UTC");
}

/** Full datetime label of `instant` on the broker server. */
export function brokerDateTimeLabel(
  config: BrokerTimeConfig,
  instant: Date,
  format: ClockFormat = "24H",
  locale = "en"
): string {
  const offset = brokerOffsetMinutes(config, instant);
  const shifted = new Date(instant.getTime() + offset * 60 * 1000);
  const [h, m] = zonedClock(shifted, "UTC").split(":").map(Number);
  return `${zonedDate(shifted, "UTC")} ${formatClock(h, m, format, locale)}`;
}

/**
 * Human description of the broker clock, e.g.:
 *  "GMT+2 / GMT+3 (New York close)" | "Europe/Riga" | "GMT+3 (fixed)".
 */
export function brokerZoneLabel(config: BrokerTimeConfig): string {
  switch (config.mode) {
    case "NY_CLOSE":
      return "GMT+2 / GMT+3 (New York close)";
    case "FIXED_OFFSET":
      return `${formatOffsetLabel(config.fixedOffsetMinutes ?? 0)} (fixed)`;
    default:
      return config.timezone || "UTC";
  }
}

/**
 * Interprets a broker-server wall-clock timestamp ("2025-03-14 10:32",
 * "2025.03.14 10:32:00", or "HH:MM" + `onDateIso`) and returns the UTC
 * instant it designates — the inverse of brokerClock. Returns null when the
 * input cannot be parsed (ambiguous fall-back hours resolve to the FIRST
 * occurrence, documented limit).
 */
export function brokerWallClockToUtc(
  config: BrokerTimeConfig,
  value: string
): Date | null {
  const normalized = value.trim().replace(/\./g, "-").replace(/T/, " ");
  const full = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    normalized
  );
  let y: number, mo: number, d: number, h: number, mi: number;
  if (full) {
    [, y, mo, d, h, mi] = full.map(Number) as unknown as [
      never,
      number,
      number,
      number,
      number,
      number
    ];
  } else {
    return null;
  }
  // Candidate UTC instant assuming offset at that wall time (iterate twice
  // to converge — the offset at the guess differs by at most an hour around
  // a DST flip, and NY_CLOSE/FIXED modes converge immediately).
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const offset = brokerOffsetMinutes(config, new Date(guess));
    const next = Date.UTC(y, mo - 1, d, h, mi) - offset * 60 * 1000;
    if (next === guess) break;
    guess = next;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Extra display zone (UserDisplayPreference.extraTimezones entries). */
export interface ExtraTimezone {
  label: string;
  ianaTimezone: string;
  kind: "USER" | "BROKER_SERVER" | "MARKET" | "UTC" | "CUSTOM";
}

/** Formats an instant in an extra zone for the top-bar clock / details. */
export function formatInExtraZone(
  instant: Date,
  zone: ExtraTimezone,
  format: ClockFormat,
  locale: string
): string {
  const [h, m] = zonedClock(instant, zone.ianaTimezone).split(":").map(Number);
  return formatClock(h, m, format, locale);
}
