/**
 * Lot 9 (roadmap section 11) - notification dedupe: at most one UNREAD
 * notification per (user, type, url, dedupeKey) inside the window; a
 * notification that was already read never blocks a new one; simultaneous
 * identical events create exactly one row; mark-read is scoped to the
 * owner and to the IN_APP channel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyInApp,
} from "@/server/notifications";

let userA: { id: string };
let userB: { id: string };

async function countRows(userId: string, type: string): Promise<number> {
  return db.notificationLog.count({
    where: { userId, type, channel: "IN_APP" },
  });
}

async function notify(
  userId: string,
  type: string,
  extra: {
    url?: string | null;
    dedupeKey?: string | null;
    dedupeWithinMs?: number;
  } = {}
): Promise<void> {
  await notifyInApp({
    userId,
    type,
    title: `Test ${type}`,
    body: "Test notification.",
    url: extra.url ?? "/test",
    dedupeKey: extra.dedupeKey ?? null,
    dedupeWithinMs: extra.dedupeWithinMs ?? 10 * 60 * 1000,
  });
}

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "notif-a@test.local",
    password: "Test1234!",
    displayName: "Notif A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "notif-b@test.local",
    password: "Test1234!",
    displayName: "Notif B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("notification dedupe", () => {
  it("an unread notification inside the window suppresses a duplicate", async () => {
    await notify(userA.id, "DEDUP_UNREAD");
    await notify(userA.id, "DEDUP_UNREAD");
    await notify(userA.id, "DEDUP_UNREAD");

    expect(await countRows(userA.id, "DEDUP_UNREAD")).toBe(1);
    const { unreadCount } = await listNotifications(userA.id);
    expect(unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("a read notification does not block a new one with the same key", async () => {
    await notify(userA.id, "DEDUP_AFTER_READ");
    expect(await countRows(userA.id, "DEDUP_AFTER_READ")).toBe(1);

    const first = await listNotifications(userA.id);
    const row = first.notifications.find((n) => n.type === "DEDUP_AFTER_READ");
    expect(row).toBeDefined();
    expect(await markNotificationRead(userA.id, row!.id)).toBe(true);

    // Same key, still inside the window - the read row must not suppress.
    await notify(userA.id, "DEDUP_AFTER_READ");
    expect(await countRows(userA.id, "DEDUP_AFTER_READ")).toBe(2);

    const second = await listNotifications(userA.id);
    const unread = second.notifications.filter(
      (n) => n.type === "DEDUP_AFTER_READ" && n.readAt === null
    );
    expect(unread).toHaveLength(1);
  });

  it("an expired window allows a new notification", async () => {
    await notify(userA.id, "DEDUP_EXPIRED");
    expect(await countRows(userA.id, "DEDUP_EXPIRED")).toBe(1);

    // Move the row outside the 10-minute window.
    await db.notificationLog.updateMany({
      where: { userId: userA.id, type: "DEDUP_EXPIRED" },
      data: { sentAt: new Date(Date.now() - 20 * 60 * 1000) },
    });

    await notify(userA.id, "DEDUP_EXPIRED");
    expect(await countRows(userA.id, "DEDUP_EXPIRED")).toBe(2);
  });

  it("dedupe keys separate alerts: url, type, dedupeKey and user", async () => {
    // Same type, different url: two rows.
    await notify(userA.id, "DEDUP_KEYS", { url: "/trades/one" });
    await notify(userA.id, "DEDUP_KEYS", { url: "/trades/two" });
    // Same url, different type: one more row.
    await notify(userA.id, "DEDUP_KEYS_OTHER", { url: "/trades/one" });
    // Same type and url, different dedupeKey: one row per key...
    await notify(userA.id, "DEDUP_KEYS", { url: "/broker-sync", dedupeKey: "conn-1" });
    await notify(userA.id, "DEDUP_KEYS", { url: "/broker-sync", dedupeKey: "conn-2" });
    // ...but the same dedupeKey twice is still deduped.
    await notify(userA.id, "DEDUP_KEYS", { url: "/broker-sync", dedupeKey: "conn-1" });
    // Same key for another user is independent.
    await notify(userB.id, "DEDUP_KEYS", { url: "/trades/one" });

    expect(await countRows(userA.id, "DEDUP_KEYS")).toBe(4);
    expect(await countRows(userA.id, "DEDUP_KEYS_OTHER")).toBe(1);
    expect(await countRows(userB.id, "DEDUP_KEYS")).toBe(1);
  });

  it("simultaneous identical events create exactly one row", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () => notify(userA.id, "DEDUP_RACE"))
    );

    expect(await countRows(userA.id, "DEDUP_RACE")).toBe(1);
  });

  it("dedupeWithinMs 0 never dedupes", async () => {
    await notify(userA.id, "DEDUP_ZERO", { dedupeWithinMs: 0 });
    await notify(userA.id, "DEDUP_ZERO", { dedupeWithinMs: 0 });

    expect(await countRows(userA.id, "DEDUP_ZERO")).toBe(2);
  });
});

describe("notification mark-read", () => {
  it("markNotificationRead is scoped to the owner and reports repeats", async () => {
    await notify(userA.id, "MARK_READ");
    const feed = await listNotifications(userA.id);
    const row = feed.notifications.find((n) => n.type === "MARK_READ");
    expect(row).toBeDefined();

    expect(await markNotificationRead(userB.id, row!.id)).toBe(false);
    expect(await markNotificationRead(userA.id, row!.id)).toBe(true);
    // Already read: no-op.
    expect(await markNotificationRead(userA.id, row!.id)).toBe(false);
  });

  it("markAllNotificationsRead only touches the caller's unread rows", async () => {
    // Earlier tests in this file left unread rows for userA: count them
    // first so the assertion is a delta, not an absolute number.
    const before = (await listNotifications(userA.id)).unreadCount;
    await notify(userA.id, "MARK_ALL_A");
    await notify(userA.id, "MARK_ALL_B");
    await notify(userB.id, "MARK_ALL_A");

    expect(await markAllNotificationsRead(userA.id)).toBe(before + 2);
    expect(await markAllNotificationsRead(userA.id)).toBe(0);

    const feedA = await listNotifications(userA.id);
    expect(
      feedA.notifications.filter((n) => n.readAt === null).length
    ).toBe(0);
    const feedB = await listNotifications(userB.id);
    expect(
      feedB.notifications.filter((n) => n.type === "MARK_ALL_A" && n.readAt === null)
        .length
    ).toBe(1);
  });

  it("listNotifications shows newest first with the unread count", async () => {
    await notify(userA.id, "LIST_FIRST");
    await notify(userA.id, "LIST_SECOND");

    const { notifications, unreadCount } = await listNotifications(userA.id);
    const mine = notifications.filter((n) => n.type.startsWith("LIST_"));
    expect(mine[0].type).toBe("LIST_SECOND");
    expect(mine[1].type).toBe("LIST_FIRST");
    expect(unreadCount).toBeGreaterThanOrEqual(2);
  });
});
