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
}

export async function runDailyMaintenance(now: Date = new Date()): Promise<MaintenanceReport> {
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  // 1. Due deletions first — RGPD deadlines beat housekeeping.
  const deletions = await executeDueDeletions(now);

  // 2. Rate-limit buckets.
  const rateLimitBucketsPruned = await pruneRateLimits(24 * 60 * 60 * 1000);

  // 3. Sync payloads (audit rows stay, personal payloads go).
  const syncPayloads = await db.syncEventLog.updateMany({
    where: { receivedAt: { lt: day(14) }, NOT: { payloadJson: null } },
    data: { payloadJson: null },
  });

  // 4. Merge undo snapshots past expiry.
  const mergeLogs = await db.tradeMergeLog.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  // 5. Overdue invitations.
  const invitations = await db.mentorInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });

  // 6. Long-expired share links (+7 d grace for open tabs).
  const shareLinks = await db.shareLink.deleteMany({
    where: { expiresAt: { lt: day(7) } },
  });

  // 7. Old notifications.
  const notifications = await db.notificationLog.deleteMany({
    where: { sentAt: { lt: day(90) } },
  });

  // 8. v2.5 M4 — trash retention (30 days) + ChangeLog pruning.
  const trashPurged = await purgeExpiredTrash(now);

  // 9. v2.5 M6 — daily trader score snapshots (best-effort, never blocks
  // the report: a failing step logs inside recordDailyTraderScores).
  const traderScores = await recordDailyTraderScores(now);

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
  };
}
