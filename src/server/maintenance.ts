/**
 * v3 Phase 6 — Daily maintenance, run by /api/cron/daily (protected by
 * CRON_SECRET — the sandbox equivalent of Vercel Cron). Every step is
 * idempotent and independently reported; a failing step logs and lets the
 * others run (the cron retries the next day).
 *
 * Steps (all documented in README v3):
 *  1. Execute due account deletions (7-day grace elapsed).
 *  2. Prune rate-limit buckets older than 24 h.
 *  3. Purge sync event payloads older than 14 days (keep the audit row,
 *     drop the personal payload — schema comment "payload purgé à 14 j").
 *  4. Delete merge undo snapshots past their expiry (30-day window).
 *  5. Mark overdue PENDING mentor invitations as EXPIRED.
 *  6. Delete share links expired more than 7 days ago (read-time already
 *     404s them; this frees the rows).
 *  7. Prune in-app notifications older than 90 days.
 *  8. v2.5 M4: purge trash items older than 30 days (DB rows + Storage
 *     objects) and prune expired ChangeLog undo snapshots.
 *  9. v2.5 M6: freeze today's trader quality score snapshot per user.
 */
import { db } from "@/lib/db";
import { pruneRateLimits } from "@/lib/rate-limit";
import { executeDueDeletions, type DeletionExecutionReport } from "@/server/account-deletion";
import { purgeExpiredTrash, type TrashPurgeReport } from "@/server/trash";
import { recordDailyTraderScores } from "@/server/advanced-analytics";

export interface MaintenanceReport {
  ranAt: string;
  deletions: DeletionExecutionReport;
  rateLimitBucketsPruned: number;
  syncPayloadsPurged: number;
  mergeLogsDeleted: number;
  invitationsExpired: number;
  shareLinksDeleted: number;
  notificationsPruned: number;
  trashPurged: TrashPurgeReport;
  traderScoreSnapshots: number;
  failures: string[];
}

async function runStep<T>(
  name: string,
  action: () => Promise<T>,
  fallback: T,
  failures: string[]
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    failures.push(name);
    console.error("[maintenance] " + name + " failed:", error);
    return fallback;
  }
}

export async function runDailyMaintenance(now: Date = new Date()): Promise<MaintenanceReport> {
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const failures: string[] = [];

  // Each step is isolated: a Storage or table failure must not prevent
  // unrelated retention, invitation or notification cleanup from running.
  const deletions = await runStep(
    "account deletions",
    () => executeDueDeletions(now),
    { executed: 0, tombstones: [] },
    failures
  );

  const rateLimitBucketsPruned = await runStep(
    "rate-limit pruning",
    () => pruneRateLimits(24 * 60 * 60 * 1000),
    0,
    failures
  );

  const syncPayloads = await runStep(
    "sync payload purge",
    () => db.syncEventLog.updateMany({
      where: { receivedAt: { lt: day(14) }, NOT: { payloadJson: null } },
      data: { payloadJson: null },
    }),
    { count: 0 },
    failures
  );

  const mergeLogs = await runStep(
    "merge log pruning",
    () => db.tradeMergeLog.deleteMany({ where: { expiresAt: { lt: now } } }),
    { count: 0 },
    failures
  );

  const invitations = await runStep(
    "invitation expiry",
    () => db.mentorInvitation.updateMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    }),
    { count: 0 },
    failures
  );

  const shareLinks = await runStep(
    "share link pruning",
    () => db.shareLink.deleteMany({ where: { expiresAt: { lt: day(7) } } }),
    { count: 0 },
    failures
  );

  const notifications = await runStep(
    "notification pruning",
    () => db.notificationLog.deleteMany({ where: { sentAt: { lt: day(90) } } }),
    { count: 0 },
    failures
  );

  const trashPurged = await runStep(
    "trash retention",
    () => purgeExpiredTrash(now),
    {
      trades: 0,
      journalEntries: 0,
      strategies: 0,
      tags: 0,
      changeLogsPruned: 0,
    },
    failures
  );

  const traderScores = await runStep(
    "trader score snapshots",
    () => recordDailyTraderScores(now),
    { users: 0, snapshots: 0 },
    failures
  );

  return {
    ranAt: now.toISOString(),
    deletions,
    rateLimitBucketsPruned,
    syncPayloadsPurged: syncPayloads.count,
    mergeLogsDeleted: mergeLogs.count,
    invitationsExpired: invitations.count,
    shareLinksDeleted: shareLinks.count,
    notificationsPruned: notifications.count,
    trashPurged,
    traderScoreSnapshots: traderScores.snapshots,
    failures,
  };
}
