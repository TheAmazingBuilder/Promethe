/**
 * Trading session detection from UTC time.
 *
 * Reference hours (UTC) — forex conventions, DST not applied (documented):
 *   ASIAN     00:00 → 07:00   (Tokyo)
 *   LONDON    07:00 → 12:00
 *   OVERLAP   12:00 → 16:00   (London + New York)
 *   NEW_YORK  16:00 → 21:00
 *   OTHER     21:00 → 24:00   (late NY / Sydney pre-open)
 *
 * Overlap has priority when ranges intersect.
 */
import type { TradingSession } from "./types";

export const SESSION_RANGES_UTC: Record<TradingSession, readonly [number, number]> = {
  ASIAN: [0, 7],
  LONDON: [7, 12],
  OVERLAP: [12, 16],
  NEW_YORK: [16, 21],
  OTHER: [21, 24],
};

/** Detect the trading session of a UTC date/time. */
export function detectSession(date: Date): TradingSession {
  const h = date.getUTCHours();
  if (h >= 12 && h < 16) return "OVERLAP";
  if (h >= 7 && h < 12) return "LONDON";
  if (h >= 16 && h < 21) return "NEW_YORK";
  if (h < 7) return "ASIAN";
  return "OTHER";
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
