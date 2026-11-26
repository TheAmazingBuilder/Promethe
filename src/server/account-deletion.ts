/**
 * v3 Phase 6 — Right to erasure (RGPD art. 17): scheduled account deletion
 * with a 7-day grace period, cancellable at any time until execution.
 *
 * Lifecycle:
 *  1. POST   (password re-auth) → PENDING, scheduledFor = now + 7 days,
 *     in-app notification (banner in settings until then).
 *  2. DELETE (cancel)            → CANCELLED, notification.
 *  3. Cron /api/cron/daily       → every PENDING whose scheduledFor has passed
 *     is executed: cascade delete of ALL user rows (74 onDelete: Cascade
 *     relations cover every table), screenshots removed from Supabase Storage, and a
 *     non-personal tombstone (HMAC-SHA256 of the user id with TOKEN_PEPPER)
 *     is kept for audit — it proves "this account was deleted on purpose"
 *     without preserving anything reversible.
 *
 * Idempotent by construction: the PENDING row disappears with the user, so a
 * re-run of the cron can never delete twice. The tombstone upsert makes even
 * a crashed-then-retried transaction safe.
 */
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { hashUserId } from "@/lib/tokens";
import { notifyUser } from "@/server/notifications";
import { deleteUploadObjects } from "@/server/uploads";

export const DELETION_GRACE_DAYS = 7;
const DELETION_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type DeletionState = {
  status: "PENDING" | "CANCELLED" | "COMPLETED";
  requestedAt: string;
  scheduledFor: string;
} | null;

export type ScheduleResult =
  | { ok: true; state: DeletionState }
  | { ok: false; code: "BAD_PASSWORD" | "ALREADY_PENDING" };

/** Current deletion state for the settings view + app banner. */
export async function getDeletionState(userId: string): Promise<DeletionState> {
  const row = await db.accountDeletionRequest.findFirst({
    where: { userId, status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { requestedAt: "desc" },
  });
  if (row) {
    return {
      status: "PENDING",
      requestedAt: row.requestedAt.toISOString(),
      scheduledFor: row.scheduledFor.toISOString(),
    };
  }
  return null;
}

/**
 * Schedules deletion after password re-authentication (defense against a
 * hijacked session scheduling irreversible damage — even with the grace
 * period, the password check keeps CSRF/shoulder-surfing noise out).
 */
export async function scheduleAccountDeletion(
  userId: string,
  password: string
): Promise<ScheduleResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, code: "BAD_PASSWORD" };
  }

  const existing = await db.accountDeletionRequest.findUnique({
    where: { userId },
    select: { status: true },
  });
  if (existing?.status === "PENDING" || existing?.status === "PROCESSING") {
    return { ok: false, code: "ALREADY_PENDING" };
  }

  const now = new Date();
  const scheduledFor = new Date(
    now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
  );

  // A previous CANCELLED request is superseded (userId is @unique — reuse row).
  const row = await db.accountDeletionRequest.upsert({
    where: { userId },
    create: { userId, status: "PENDING", requestedAt: now, scheduledFor },
    update: { status: "PENDING", requestedAt: now, scheduledFor, completedAt: null },
  });

  await notifyUser({
    userId,
    type: "DELETION_SCHEDULED",
    title: "Account deletion scheduled",
    body: `Your account and all your data will be permanently deleted on ${scheduledFor.toLocaleDateString(
      "en-CA",
      { day: "numeric", month: "long", year: "numeric" }
    )}. You can cancel at any time before then.`,
    url: "/settings/account",
    dedupeWithinMs: 0,
  });

  return {
    ok: true,
    state: {
      status: row.status as "PENDING",
      requestedAt: row.requestedAt.toISOString(),
      scheduledFor: row.scheduledFor.toISOString(),
    },
  };
}

/** Cancels a PENDING deletion (grace period). Returns false when none pending. */
export async function cancelAccountDeletion(userId: string): Promise<boolean> {
  const updated = await db.accountDeletionRequest.updateMany({
    where: { userId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (updated.count === 0) return false;

  await notifyUser({
    userId,
    type: "DELETION_CANCELLED",
    title: "Account deletion cancelled",
    body: "Your deletion request was cancelled. Your data is kept.",
    url: "/settings/account",
    dedupeWithinMs: 0,
  });
  return true;
}

export interface DeletionExecutionReport {
  executed: number;
  /** Tombstone ids created (HMAC of user ids - audit trail). */
  tombstones: string[];
}

/**
 * Cron step: executes every due PENDING deletion. All user rows cascade
 * (schema-wide onDelete: Cascade), uploads are removed from Supabase Storage, and the
 * tombstone is written in the SAME transaction so a crash between the two
 * steps can never leave personal data behind without a tombstone or vice
 * versa.
 */
export async function executeDueDeletions(
  now: Date = new Date()
): Promise<DeletionExecutionReport> {
  const staleLeaseBefore = new Date(now.getTime() - DELETION_PROCESSING_LEASE_MS);
  const due = await db.accountDeletionRequest.findMany({
    where: {
      scheduledFor: { lte: now },
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", completedAt: { lte: staleLeaseBefore } },
      ],
    },
    select: { userId: true, status: true, completedAt: true },
  });

  const report: DeletionExecutionReport = { executed: 0, tombstones: [] };

  for (const candidate of due) {
    // Claim the request before touching Storage. Cancellation only updates
    // PENDING rows, so a successful compare-and-set starts execution.
    if (candidate.status === "PROCESSING" && !candidate.completedAt) continue;
    const claimedAt = now;
    const claimWhere =
      candidate.status === "PROCESSING"
        ? {
            userId: candidate.userId,
            status: "PROCESSING",
            completedAt: candidate.completedAt!,
          }
        : {
            userId: candidate.userId,
            status: "PENDING",
            scheduledFor: { lte: now },
          };

    let claim: { count: number };
    try {
      claim = await db.accountDeletionRequest.updateMany({
        where: claimWhere,
        data: { status: "PROCESSING", completedAt: claimedAt },
      });
    } catch (error) {
      console.error("[deletion] claim failed:", error);
      continue;
    }
    if (claim.count !== 1) continue;

    const tombstoneId = hashUserId(candidate.userId);
    try {
      // Keep object keys before the user cascade removes screenshot rows.
      const screenshotRows = await db.tradeScreenshot.findMany({
        where: { userId: candidate.userId },
        select: { storagePath: true },
      });

      // Missing objects are idempotent. On Storage failure, release the
      // lease to PENDING so a later cron can retry.
      await deleteUploadObjects(screenshotRows.map((row) => row.storagePath));

      await db.$transaction(async (tx) => {
        // A reclaimed lease must not let a slow, old worker delete the user.
        const stillOwned = await tx.accountDeletionRequest.updateMany({
          where: {
            userId: candidate.userId,
            status: "PROCESSING",
            completedAt: claimedAt,
          },
          data: { completedAt: claimedAt },
        });
        if (stillOwned.count !== 1) {
          throw new Error("Account deletion processing lease was lost.");
        }

        await tx.deletedUserTombstone.upsert({
          where: { id: tombstoneId },
          create: { id: tombstoneId, completedAt: now },
          update: { completedAt: now },
        });
        await tx.user.delete({ where: { id: candidate.userId } });
      });

      report.executed += 1;
      report.tombstones.push(tombstoneId);
    } catch (error) {
      // Release only our own lease; never reset a newer worker's claim.
      await db.accountDeletionRequest.updateMany({
        where: {
          userId: candidate.userId,
          status: "PROCESSING",
          completedAt: claimedAt,
        },
        data: { status: "PENDING", completedAt: null },
      }).catch(() => undefined);
      console.error("[deletion] failed for user (hashed) " + tombstoneId + ":", error);
    }
  }

  return report;
}
