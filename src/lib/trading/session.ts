/**
 * Trading session detection.
 *
 * v2.5 Module 5: the ranges are no longer hardcoded - they come from the
 * MarketSessionSetting DETECTION rows (editable in the settings, stored in
 * the database). The defaults below reproduce the legacy UTC ranges
 * exactly, so existing trades keep their historical session:
 *   ASIAN     00:00 → 07:00   (Tokyo)
 *   LONDON    07:00 → 12:00
 *   OVERLAP   12:00 → 16:00   (London + New York)
 *   NEW_YORK  16:00 → 21:00
 *   OTHER     21:00 → 24:00   (late NY / Sydney pre-open)
 *
 * Overlap has priority when ranges intersect.
 *
 * This module is synchronous and uses the defaults: it is used on the
 * client (live previews) and as the fallback when no user settings exist.
 * Server code that knows the user must use `detectSessionForUser` from
 * src/server/tools.ts, which reads the DETECTION rows from the database
 * and falls back to these same defaults.
 */
import type { TradingSession } from "./types";
import {
  DEFAULT_DETECTION_SETTINGS,
  detectSessionFromSettings,
} from "@/lib/tools/market-hours";

export const SESSION_RANGES_UTC: Record<TradingSession, readonly [number, number]> = {
  ASIAN: [0, 7],
  LONDON: [7, 12],
  OVERLAP: [12, 16],
  NEW_YORK: [16, 21],
  OTHER: [21, 24],
};

/** Detect the trading session of a UTC date/time (legacy defaults). */
export function detectSession(date: Date): TradingSession {
  return detectSessionFromSettings(date, DEFAULT_DETECTION_SETTINGS);
}

/** Detect session from an ISO string / epoch millis. Returns null on invalid input. */
export function detectSessionSafe(
  value: Date | string | number | null | undefined
): TradingSession | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return detectSession(d);
}
