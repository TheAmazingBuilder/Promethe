/**
 * Web Push delivery - durable outbox, mirroring the integrations outbox
 * (src/server/integrations/delivery.ts) in shape: claim, retry with
 * exponential backoff, DEAD after MAX_PUSH_ATTEMPTS.
 *
 * Flow: notifyUser() (src/server/notifications.ts) creates the in-app
 * row, then enqueuePushNotification() queues one PushOutbox row per
 * subscribed device of that user. processPushOutbox() is driven by
 * POST /api/cron/integrations (same Bearer CRON_SECRET cron that drains
 * the Discord / Telegram outbox, every 15 min) and sends each row with
 * sendWebPush(). Every attempt writes one NotificationLog row with
 * channel = 'PUSH' (SENT / FAILED / SKIPPED) - the in-app center only
 * ever lists IN_APP rows, so push attempts never appear in the bell.
 *
 * A 410/404 from the push service means the subscription expired: the
 * subscription row is deleted and the queued row goes DEAD. A missing
 * VAPID config defers the whole queue (no attempts consumed) instead of
 * burning rows on an ops problem.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isPushConfigured } from "@/lib/push/vapid";
import { sendWebPush, type PushSendOutcome } from "@/lib/push/send";
import { getOwnPushSubscription } from "@/server/push/subscriptions";

export const MAX_PUSH_ATTEMPTS = 5;
const PUSH_OUTBOX_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

export interface PushOutboxReport {
  processed: number;
  sent: number;
  failed: number;
  dead: number;
  /** Expired subscriptions deleted (410/404 from the push service). */
  gone: number;
}

function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[push] ${message}: ${detail.slice(0, 200)}`);
}

function backoffDelayMs(attempts: number): number {
  const minutes = Math.min(2 ** attempts, 60);
  return minutes * 60 * 1000;
}

/** One audit row per delivery attempt (channel PUSH, never in the bell). */
async function logPushAttempt(
  userId: string,
  row: {
    type: string;
    title: string;
    body: string;
    url: string | null;
    dedupeKey: string;
  },
  status: "SENT" | "FAILED" | "SKIPPED"
): Promise<void> {
  try {
    await db.notificationLog.create({
      data: {
        userId,
        type: row.type,
        channel: "PUSH",
        title: row.title,
        body: row.body,
        url: row.url,
        dedupeKey: row.dedupeKey,
        status,
      },
    });
  } catch (error) {
    logError("push attempt log failed", error);
  }
}

/**
 * Queue one push per subscribed device for a just-created in-app
 * notification. The in-app row is loaded by id, so the push payload is
 * exactly what the user sees in the bell (amounts already redacted there).
 * Idempotent per (device, alert instance): a re-enqueue hits the unique
 * (subscriptionId, dedupeKey) constraint and is skipped. Never throws.
 */
export async function enqueuePushNotification(
  userId: string,
  notificationId: string
): Promise<{ enqueued: number; skipped: number }> {
  try {
    if (!isPushConfigured()) return { enqueued: 0, skipped: 0 };
    const notification = await db.notificationLog.findFirst({
      where: { id: notificationId, userId, channel: "IN_APP" },
      select: { type: true, title: true, body: true, url: true },
    });
    if (!notification) return { enqueued: 0, skipped: 0 };
    const subscriptions = await db.pushSubscription.findMany({
      where: { userId },
      select: { id: true },
    });
    let enqueued = 0;
    let skipped = 0;
    for (const sub of subscriptions) {
      try {
        await db.pushOutbox.create({
          data: {
            userId,
            subscriptionId: sub.id,
            type: notification.type,
            title: notification.title,
            body: notification.body,
            url: notification.url,
            dedupeKey: notificationId,
            status: "PENDING",
            nextAttemptAt: new Date(),
          },
        });
        enqueued += 1;
      } catch (error) {
        // Duplicate (race) or other write issue: skip, stay best-effort.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          skipped += 1;
        } else {
          skipped += 1;
        }
      }
    }
    return { enqueued, skipped };
  } catch (error) {
    logError("push enqueue failed", error);
    return { enqueued: 0, skipped: 0 };
  }
}

/**
 * Atomically finalize a row only while this worker still owns its lease.
 * updatedAt is the lease version: a reclaimed row receives a newer value,
 * preventing an expired worker from overwriting the new owner's result.
 */
async function updateClaimedPushOutbox(
  id: string,
  claimedAt: Date,
  data: Prisma.PushOutboxUpdateManyMutationInput
): Promise<boolean> {
  const result = await db.pushOutbox.updateMany({
    where: { id, status: "PROCESSING", updatedAt: claimedAt },
    data,
  });
  return result.count === 1;
}

/**
 * Drain due PENDING/FAILED rows. PROCESSING rows whose two-minute lease
 * expired are recoverable after a crashed worker. Claims use
 * compare-and-set, so concurrent cron runs cannot both send the same row.
 */
export async function processPushOutbox(
  limit = 50,
  now = new Date(),
  fetchImpl?: typeof fetch
): Promise<PushOutboxReport> {
  const report: PushOutboxReport = {
    processed: 0,
    sent: 0,
    failed: 0,
    dead: 0,
    gone: 0,
  };
  if (!isPushConfigured()) {
    logError("VAPID not configured - push queue deferred", "");
    return report;
  }
  const staleLockBefore = new Date(now.getTime() - PUSH_OUTBOX_LOCK_TIMEOUT_MS);
  let candidates;
  try {
    candidates = await db.pushOutbox.findMany({
      where: {
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
          { status: "PROCESSING", updatedAt: { lte: staleLockBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, status: true, updatedAt: true },
    });
  } catch (error) {
    logError("push outbox read failed", error);
    return report;
  }

  for (const candidate of candidates) {
    const claimWhere =
      candidate.status === "PROCESSING"
        ? {
            id: candidate.id,
            status: "PROCESSING",
            updatedAt: { lte: staleLockBefore },
          }
        : {
            id: candidate.id,
            status: candidate.status,
            nextAttemptAt: { lte: now },
          };
    let claimed: { count: number };
    try {
      claimed = await db.pushOutbox.updateMany({
        where: claimWhere,
        data: { status: "PROCESSING" },
      });
    } catch (error) {
      logError("push outbox claim failed", error);
      continue;
    }
    if (claimed.count !== 1) continue;

    const row = await db.pushOutbox.findUnique({
      where: { id: candidate.id },
      include: { subscription: true },
    });
    if (!row || row.status !== "PROCESSING") continue;
    const claimedAt = row.updatedAt;
    report.processed += 1;

    const subscription = row.subscription;
    if (!subscription) {
      if (
        await updateClaimedPushOutbox(row.id, claimedAt, {
          status: "DEAD",
          lastError: "Subscription deleted.",
        })
      ) {
        await logPushAttempt(row.userId, row, "SKIPPED");
        report.dead += 1;
      }
      continue;
    }

    // Per-user send rate limit (best effort, never blocks the queue).
    try {
      const rl = await consumeRateLimit(`push:${row.userId}`, 30, 60 * 1000);
      if (!rl.allowed) {
        const deferred = await updateClaimedPushOutbox(row.id, claimedAt, {
          status: "PENDING",
          nextAttemptAt: new Date(now.getTime() + 60 * 1000),
        });
        if (deferred) report.failed += 1;
        continue;
      }
    } catch (error) {
      logError("rate limit check failed", error);
    }

    const outcome: PushSendOutcome = await sendWebPush({
      subscription: {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      payload: { title: row.title, body: row.body, url: row.url ?? undefined },
      fetchImpl,
      now,
    });

    if (outcome.ok) {
      const sent = await updateClaimedPushOutbox(row.id, claimedAt, {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
      });
      if (sent) {
        await logPushAttempt(row.userId, row, "SENT");
        report.sent += 1;
      }
      continue;
    }

    if (outcome.gone) {
      // Mark DEAD and log FIRST: deleting the subscription cascades to
      // its outbox rows (same as the integrations outbox), so the update
      // must happen before the delete or it matches nothing.
      const finalized = await updateClaimedPushOutbox(row.id, claimedAt, {
        status: "DEAD",
        lastError: outcome.error,
      });
      await db.pushSubscription.deleteMany({
        where: { id: subscription.id, userId: row.userId },
      });
      if (finalized) {
        await logPushAttempt(row.userId, row, "FAILED");
        report.dead += 1;
        report.gone += 1;
      }
      continue;
    }

    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_PUSH_ATTEMPTS;
    const nextAttemptAt =
      outcome.retryAfterSeconds != null
        ? new Date(
            now.getTime() +
              Math.min(Math.max(outcome.retryAfterSeconds, 1), 3600) * 1000
          )
        : new Date(now.getTime() + backoffDelayMs(attempts));
    const finalized = await updateClaimedPushOutbox(row.id, claimedAt, {
      status: exhausted ? "DEAD" : "FAILED",
      attempts,
      lastError: outcome.error ?? "Send failed.",
      ...(exhausted ? {} : { nextAttemptAt }),
    });
    if (!finalized) continue;
    await logPushAttempt(row.userId, row, "FAILED");
    if (exhausted) report.dead += 1;
    else report.failed += 1;
  }
  return report;
}

/**
 * Send one test push straight away to the caller's own subscription
 * (used by the "Send test" button). Direct send, not queued: the user
 * clicked and waits for the result. The attempt is logged like any other.
 */
export async function sendPushTest(
  userId: string,
  endpoint: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const subscription = await getOwnPushSubscription(userId, endpoint);
    if (!subscription) return { ok: false, error: "SUBSCRIPTION_NOT_FOUND" };
    if (!isPushConfigured()) return { ok: false, error: "VAPID_NOT_CONFIGURED" };
    const outcome = await sendWebPush({
      subscription,
      payload: {
        title: "Promethe",
        body: "Push notifications are working on this device.",
        url: "/settings/profile",
      },
      fetchImpl,
    });
    if (!outcome.ok && outcome.gone) {
      await db.pushSubscription.deleteMany({
        where: { id: subscription.id, userId },
      });
    }
    const status = outcome.ok ? "SENT" : "FAILED";
    await db.notificationLog.create({
      data: {
        userId,
        type: "TEST",
        channel: "PUSH",
        title: "Promethe",
        body: "Push notifications are working on this device.",
        url: "/settings/profile",
        dedupeKey: null,
        status,
      },
    });
    if (outcome.ok) return { ok: true };
    return { ok: false, error: outcome.error ?? "TEST_FAILED" };
  } catch (error) {
    logError("push test failed", error);
    return { ok: false, error: "TEST_FAILED" };
  }
}
