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
 *     relations cover every table), screenshots removed from disk, and a
 *     non-personal tombstone (HMAC-SHA256 of the user id with TOKEN_PEPPER)
 *     is kept for audit — it proves "this account was deleted on purpose"
 *     without preserving anything reversible.
 *
 * Idempotent by construction: the PENDING row disappears with the user, so a
 * re-run of the cron can never delete twice. The tombstone upsert makes even
 * a crashed-then-retried transaction safe.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { hashUserId } from "@/lib/tokens";
import { notifyInApp } from "@/server/notifications";
import { UPLOAD_ROOT } from "@/server/uploads";

export const DELETION_GRACE_DAYS = 7;

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
    where: { userId, status: "PENDING" },
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

  const existing = await db.accountDeletionRequest.findFirst({
    where: { userId, status: "PENDING" },
  });
  if (existing) {
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

  await notifyInApp({
    userId,
    type: "DELETION_SCHEDULED",
    title: "Account deletion scheduled",
    body: `Your account and all your data will be permanently deleted on ${scheduledFor.toLocaleDateString(
      "en-CA",
      { day: "numeric", month: "long", year: "numeric" }
    )}. You can cancel at any time before then.`,
    url: "#/reglages/compte",
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

  await notifyInApp({
    userId,
    type: "DELETION_CANCELLED",
    title: "Account deletion cancelled",
    body: "Your deletion request was cancelled. Your data is kept.",
    url: "#/reglages/compte",
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
 * (schema-wide onDelete: Cascade), uploads are removed from disk, and the
 * tombstone is written in the SAME transaction so a crash between the two
 * steps can never leave personal data behind without a tombstone or vice
 * versa.
 */
export async function executeDueDeletions(
  now: Date = new Date()
): Promise<DeletionExecutionReport> {
  const due = await db.accountDeletionRequest.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    select: { userId: true },
  });

  const report: DeletionExecutionReport = { executed: 0, tombstones: [] };

  for (const { userId } of due) {
    const tombstoneId = hashUserId(userId);
    try {
      await db.$transaction(async (tx) => {
        // Tombstone first (same tx): proof of intentional deletion, irreversible.
        await tx.deletedUserTombstone.upsert({
          where: { id: tombstoneId },
          create: { id: tombstoneId, completedAt: now },
          update: { completedAt: now },
        });
        // Cascade: profile, accounts, trades, executions, screenshots rows,
        // comments, mentor accesses (both directions), consents, sessions,
        // notifications… every table. Comments the user wrote on OTHER
        // users' journals are deleted too (their personal data — RGPD
        // requires it; the schema chose hard delete over anonymisation).
        await tx.user.delete({ where: { id: userId } });
      });

      // Best-effort file cleanup AFTER the DB commit — files are not
      // transactional. A leftover empty dir is harmless; data rows are gone.
      await rm(path.join(UPLOAD_ROOT, userId), {
        recursive: true,
        force: true,
      }).catch(() => undefined);

      report.executed += 1;
      report.tombstones.push(tombstoneId);
    } catch (error) {
      // One user's failure must not block the others; the row stays PENDING
      // and the next cron run retries.
      console.error(`[deletion] failed for user (hashed) ${tombstoneId}:`, error);
    }
  }

  return report;
}
