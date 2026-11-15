/**
 * v3 — Notification service (minimal core).
 *
 * v2 spec had NotificationLog + ReminderSetting models; v3 builds the actual
 * service on them. In the sandbox only the IN_APP channel exists — email
 * (Resend) and web push are isolated behind notifyUser() so they can be
 * plugged in without touching call sites.
 *
 * Features: per-type dedupe windows (a STALE connection alerts once a day,
 * comment bursts debounce to one per trade per 10 min — Phase 5), unread
 * counts, mark-read. Titles/bodies are SERVER strings (FR default) because
 * they are persisted data, not UI chrome — same trade-off as seeded
 * reference data (documented in README i18n section).
 */
import { db } from "@/lib/db";
import { shouldHideAmountsInNotifications } from "@/server/display-preferences";
import { redactAmountsInText } from "@/lib/privacy/policy";

export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL";

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  /** Skip if an unread notification of the same (type, url) exists newer than this. */
  dedupeWithinMs?: number;
}

const DEFAULT_DEDUPE_MS = 10 * 60 * 1000;

/** Creates an in-app notification (deduped). Never throws — best effort. */
export async function notifyInApp(input: NotifyInput): Promise<void> {
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
    if (dedupeMs > 0) {
      const since = new Date(Date.now() - dedupeMs);
      const existing = await db.notificationLog.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          url: input.url ?? null,
          channel: "IN_APP",
          sentAt: { gt: since },
        },
        select: { id: true },
      });
      if (existing) return;
    }

    await db.notificationLog.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel: "IN_APP",
        title,
        body,
        url: input.url ?? null,
        status: "SENT",
      },
    });
  } catch (error) {
    console.error("[notifications] failed:", error);
  }
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
  const updated = await db.notificationLog.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const updated = await db.notificationLog.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count;
}
