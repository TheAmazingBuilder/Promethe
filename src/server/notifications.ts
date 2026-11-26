/**
 * v3 - Notification service (in-app center + Web Push fan-out).
 *
 * The in-app center is the source of truth: notifyInApp() creates a
 * deduped IN_APP row, and notifyUser() fans the same alert out to Web
 * Push for the user's subscribed devices (src/server/push/delivery.ts).
 * Email is NOT implemented: no Resend/SMTP sender, no notifyUser()
 * email fan-out. The external alerts (daily summary, drawdown, prop)
 * live in the integrations outbox (Discord/Telegram) and are NOT driven
 * by this service. Channel design and what is still missing are
 * documented in docs/notifications.md.
 *
 * Features: per-type dedupe windows (a STALE connection alerts at most
 * once per 6 h, a MISMATCH at most once per 24 h, comment bursts debounce
 * to one per trade per 10 min — Phase 5), unread counts, mark-read.
 * Titles/bodies are SERVER strings (FR default) because they are
 * persisted data, not UI chrome — same trade-off as seeded reference
 * data (documented in README i18n section).
 */
import { db } from "@/lib/db";
import { shouldHideAmountsInNotifications } from "@/server/display-preferences";
import { redactAmountsInText } from "@/lib/privacy/policy";
import { enqueuePushNotification } from "@/server/push/delivery";

export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL";

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  /**
   * Optional dedupe key segment: alerts sharing (type, url) but concerning
   * different entities pass their own key here so they never suppress each
   * other (one broker connection per SYNC_STALE / SYNC_MISMATCH alert).
   * Null means "no extra segment" and matches only other null keys.
   */
  dedupeKey?: string | null;
  /** Skip if an unread notification with the same dedupe key exists newer than this. */
  dedupeWithinMs?: number;
}

const DEFAULT_DEDUPE_MS = 10 * 60 * 1000;

/**
 * Creates an in-app notification (deduped). Never throws - best effort.
 *
 * Dedupe rule (lot 9): at most one UNREAD notification per
 * (userId, type, url, dedupeKey, channel) inside the window. A notification
 * that was already read never blocks a new one. Simultaneous calls for the
 * same key are serialized with a Postgres advisory lock held for the
 * check-then-insert transaction, so two identical events cannot both slip
 * through the check.
 */
/**
 * In-app notification (notification center only). Returns the created row
 * id when a row was actually created, null when the notification was
 * deduped away (an unread twin inside the window) or the write failed.
 * Callers that count sent notifications must use this return value: a
 * deduped call is not a sent notification (lot 10 economic-calendar
 * alerts). The id is also the push outbox dedupe key (see notifyUser).
 */
export async function notifyInApp(input: NotifyInput): Promise<string | null> {
  try {
    // v2.5 Module 8 — when hideAmountsInNotifications is on, amounts never
    // reach the persisted body (R/pips policy). Composers should already
    // avoid amounts; this is the server-side defense in depth that also
    // covers future PUSH/EMAIL channels composed from the same strings.
    let title = input.title;
    let body = input.body;
    if (await shouldHideAmountsInNotifications(input.userId)) {
      title = redactAmountsInText(title);
      body = redactAmountsInText(body);
    }

    const dedupeMs = input.dedupeWithinMs ?? DEFAULT_DEDUPE_MS;
    const dedupeKey = input.dedupeKey ?? null;
    const url = input.url ?? null;
    const data = {
      userId: input.userId,
      type: input.type,
      channel: "IN_APP" as const,
      title,
      body,
      url,
      dedupeKey,
      status: "SENT",
    };
    if (dedupeMs <= 0) {
      const row = await db.notificationLog.create({ data });
      return row.id;
    }

    // Serialize concurrent notifies for the same dedupe key: the lock is
    // held until the transaction commits, so a second caller always sees
    // the first caller's row (or its absence after the window expired).
    const lockKey = [input.userId, input.type, url ?? "", dedupeKey ?? "", "IN_APP"].join("|");
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      const since = new Date(Date.now() - dedupeMs);
      const existing = await tx.notificationLog.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          url,
          dedupeKey,
          channel: "IN_APP",
          readAt: null,
          sentAt: { gt: since },
        },
        select: { id: true },
      });
      if (existing) return null;
      const row = await tx.notificationLog.create({ data });
      return row.id;
    });
    return created;
  } catch (error) {
    console.error("[notifications] failed:", error);
    return null;
  }
}

/**
 * Fan-out for user alerts: creates the in-app notification, then queues
 * the same alert (exact title/body, amounts already redacted) as a Web
 * Push per subscribed device of that user. Only alerts that were actually
 * created fan out: a deduped call sends nothing anywhere. The push
 * enqueue is best-effort and never throws, so a push failure can never
 * break the in-app notification or the operation that triggered it.
 *
 * Fanned-out types (the notifyInApp alert types): SYNC_STALE,
 * SYNC_MISMATCH, ECONOMIC_EVENT_SOON, DELETION_SCHEDULED,
 * DELETION_CANCELLED. Daily summaries, drawdown and prop alerts are NOT
 * fanned out here: they live in the integrations outbox with their own
 * per-endpoint subscriptions and quiet hours (Discord / Telegram).
 */
export async function notifyUser(input: NotifyInput): Promise<boolean> {
  const notificationId = await notifyInApp(input);
  if (!notificationId) return false;
  try {
    await enqueuePushNotification(input.userId, notificationId);
  } catch (error) {
    console.error("[notifications] push fan-out failed:", error);
  }
  return true;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  sentAt: string;
  readAt: string | null;
}

export async function listNotifications(
  userId: string,
  limit = 30
): Promise<{ notifications: NotificationDTO[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    db.notificationLog.findMany({
      where: { userId, channel: "IN_APP" },
      orderBy: { sentAt: "desc" },
      take: limit,
    }),
    db.notificationLog.count({
      where: { userId, channel: "IN_APP", readAt: null },
    }),
  ]);

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      url: row.url,
      sentAt: row.sentAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
    unreadCount,
  };
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  // Scoped to IN_APP: this center only ever shows in-app rows, and a
  // future PUSH/EMAIL attempt logged in the same table must not be marked
  // read from here.
  const updated = await db.notificationLog.updateMany({
    where: { id, userId, channel: "IN_APP", readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  // Scoped to IN_APP for the same reason as markNotificationRead.
  const updated = await db.notificationLog.updateMany({
    where: { userId, channel: "IN_APP", readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count;
}
