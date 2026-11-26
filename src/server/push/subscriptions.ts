/**
 * Web Push subscriptions - server-side data access.
 *
 * One row per device (endpoint UNIQUE). A row existing means the user
 * opted in to browser push on that device; deleting the row opts out.
 * The browser PushSubscription endpoint is per (browser, application
 * server key): if another user subscribes from the same browser, the
 * endpoint transfers to the latest subscriber, so pushes always go to
 * the account currently signed in on that device.
 */
import { db } from "@/lib/db";
import type { PushSubscriptionPayload } from "@/lib/validations/push";

export interface PushSubscriptionDTO {
  id: string;
  endpoint: string;
  createdAt: string;
  lastSeenAt: string;
}

function toDTO(row: {
  id: string;
  endpoint: string;
  createdAt: Date;
  lastSeenAt: Date;
}): PushSubscriptionDTO {
  return {
    id: row.id,
    endpoint: row.endpoint,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * Subscribe (or re-subscribe) this device. Upserts on the endpoint and
 * refreshes lastSeenAt, so a repeated subscribe never duplicates the row.
 */
export async function subscribePush(
  userId: string,
  input: PushSubscriptionPayload,
  userAgent?: string | null
): Promise<PushSubscriptionDTO> {
  const row = await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: {
      userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent ?? undefined,
      lastSeenAt: new Date(),
    },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent ?? null,
    },
  });
  return toDTO(row);
}

/** Unsubscribe this device. Only the owner's own rows can be removed. */
export async function unsubscribePush(userId: string, endpoint: string): Promise<boolean> {
  const deleted = await db.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });
  return deleted.count > 0;
}

/** The caller's subscription for one endpoint, if it is theirs. */
export async function getOwnPushSubscription(
  userId: string,
  endpoint: string
): Promise<{ id: string; endpoint: string; p256dh: string; auth: string } | null> {
  return db.pushSubscription.findFirst({
    where: { endpoint, userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
}
