/**
 * v3 — Connection status evaluation (pure).
 *
 * Statuses: PENDING (no heartbeat yet) | ACTIVE | STALE | MISMATCH | REVOKED.
 * STALE = no heartbeat for 30+ minutes during a weekday market session;
 * weekends never alert (FX closes Fri ~22:00 UTC, reopens Sun ~22:00 UTC).
 */

/** TRUE during the FX weekend (Sat, Sun, or Friday after 22:00 UTC). */
export function isWeekendUtc(now: Date = new Date()): boolean {
  const day = now.getUTCDay(); // 0 = Sun … 6 = Sat
  if (day === 0 || day === 6) return true;
  if (day === 5 && now.getUTCHours() >= 22) return true;
  return false;
}

export type ConnectionLifeStatus = "PENDING" | "ACTIVE" | "STALE";

/** Weekday staleness threshold (minutes without heartbeat). */
export const STALE_WEEKDAY_MIN = 30;
/** Weekend threshold - no alert unless the terminal was down for days. */
export const STALE_WEEKEND_MIN = 72 * 60;

/**
 * Derives PENDING/ACTIVE/STALE from the last heartbeat age. MISMATCH and
 * REVOKED are sticky states only the user (or a correct rebinding) clears.
 */
export function evaluateLifeStatus(
  lastHeartbeatAt: Date | null,
  now: Date = new Date()
): ConnectionLifeStatus {
  if (!lastHeartbeatAt) return "PENDING";
  const ageMinutes = (now.getTime() - lastHeartbeatAt.getTime()) / 60_000;
  if (ageMinutes < 0) return "ACTIVE"; // clock skew - tolerate
  const threshold = isWeekendUtc(now) ? STALE_WEEKEND_MIN : STALE_WEEKDAY_MIN;
  return ageMinutes > threshold ? "STALE" : "ACTIVE";
}

/** Heartbeat cadence enforced for AccountEquitySnapshot (downsampling). */
export const EQUITY_SNAPSHOT_MIN_INTERVAL_MIN = 15;

/** True when a new equity snapshot should be persisted for this heartbeat. */
export function shouldRecordEquitySnapshot(
  latestSnapshotAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!latestSnapshotAt) return true;
  return (
    now.getTime() - latestSnapshotAt.getTime() >=
    EQUITY_SNAPSHOT_MIN_INTERVAL_MIN * 60_000
  );
}

/** Payload timestamp skew tolerated by the ingest endpoints (replay guard). */
export const MAX_SKEW_SECONDS = 10 * 60;

/** True when a payload `sentAt` is within the tolerated clock skew. */
export function withinSkew(sentAt: number, now: Date = new Date()): boolean {
  return Math.abs(now.getTime() / 1000 - sentAt) <= MAX_SKEW_SECONDS;
}
