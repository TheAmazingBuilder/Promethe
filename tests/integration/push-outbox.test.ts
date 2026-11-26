/**
 * Web Push outbox (§25.4) - fan-out from notifyUser(), durable queue
 * with claim / retry / backoff / DEAD, per-attempt PUSH logging, 410
 * deletes the subscription, missing VAPID defers the queue.
 *
 * All sends use a stubbed fetch (no network). VAPID keys are a throwaway
 * pair set in-process for this file only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createECDH } from "node:crypto";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { notifyUser, listNotifications } from "@/server/notifications";
import { toBase64Url } from "@/lib/push/vapid";
import { subscribePush } from "@/server/push/subscriptions";
import {
  processPushOutbox,
  sendPushTest,
} from "@/server/push/delivery";
import { consumeRateLimit } from "@/lib/rate-limit";

let userA: { id: string };
let userB: { id: string };
let userC: { id: string };

const vapid = createECDH("prime256v1");
vapid.generateKeys();
const VAPID_PUBLIC = toBase64Url(vapid.getPublicKey(null, "uncompressed"));
const VAPID_PRIVATE = toBase64Url(vapid.getPrivateKey());

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const KEYS = {
  p256dh: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
  auth: toBase64Url(Buffer.from("0123456789abcdef", "utf8")),
};
const ENDPOINT_A = "https://push.example.com/send/device-a";
const ENDPOINT_C = "https://push.example.com/send/device-c";

function stubFetch(status: number, retryAfter?: string): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

async function countOutbox(
  userId: string,
  status?: string
): Promise<number> {
  return db.pushOutbox.count({
    where: { userId, ...(status ? { status } : {}) },
  });
}

async function countPushLogs(userId: string, status?: string): Promise<number> {
  return db.notificationLog.count({
    where: { userId, channel: "PUSH", ...(status ? { status } : {}) },
  });
}

async function alertUser(
  userId: string,
  type: string,
  url: string
): Promise<boolean> {
  return notifyUser({
    userId,
    type,
    title: `Test ${type}`,
    body: "Test notification body.",
    url,
  });
}

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
  const a = await createUserWithDefaults({
    email: "push-out-a@test.local",
    password: "Test1234!",
    displayName: "Push Out A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "push-out-b@test.local",
    password: "Test1234!",
    displayName: "Push Out B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  const c = await createUserWithDefaults({
    email: "push-out-c@test.local",
    password: "Test1234!",
    displayName: "Push Out C",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;
  userC = c.user;
  await subscribePush(userA.id, { endpoint: ENDPOINT_A, keys: KEYS });
});

afterAll(async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await db.user.deleteMany({
    where: { id: { in: [userA.id, userB.id, userC.id] } },
  });
  await db.$disconnect();
});

describe("push outbox - fan-out", () => {
  it("notifyUser creates the in-app row and one outbox row per device", async () => {
    expect(await alertUser(userA.id, "FANOUT_A", "/test-fanout-a")).toBe(true);
    expect(
      await db.notificationLog.count({
        where: { userId: userA.id, type: "FANOUT_A", channel: "IN_APP" },
      })
    ).toBe(1);
    const rows = await db.pushOutbox.findMany({
      where: { userId: userA.id, type: "FANOUT_A" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].title).toBe("Test FANOUT_A");
    // The outbox dedupe key is the in-app row id.
    const inApp = await db.notificationLog.findFirst({
      where: { userId: userA.id, type: "FANOUT_A", channel: "IN_APP" },
      select: { id: true },
    });
    expect(rows[0].dedupeKey).toBe(inApp!.id);
  });

  it("a user with no subscription gets the in-app row only", async () => {
    expect(await alertUser(userB.id, "FANOUT_B", "/test-fanout-b")).toBe(true);
    expect(await countOutbox(userB.id)).toBe(0);
  });

  it("a deduped alert fans out nothing", async () => {
    expect(await alertUser(userA.id, "FANOUT_DEDUPE", "/test-dedupe")).toBe(true);
    expect(await alertUser(userA.id, "FANOUT_DEDUPE", "/test-dedupe")).toBe(false);
    expect(
      await db.notificationLog.count({
        where: { userId: userA.id, type: "FANOUT_DEDUPE", channel: "IN_APP" },
      })
    ).toBe(1);
    expect(await countOutbox(userA.id, "PENDING")).toBe(2); // FANOUT_A + FANOUT_DEDUPE
  });
});

describe("push outbox - drain", () => {
  it("201 sends the row and logs one PUSH SENT attempt", async () => {
    const report = await processPushOutbox(50, new Date(), stubFetch(201));
    expect(report.processed).toBe(2);
    expect(report.sent).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.dead).toBe(0);
    expect(await countOutbox(userA.id, "SENT")).toBe(2);
    expect(await countPushLogs(userA.id, "SENT")).toBe(2);
    // Push attempts never appear in the bell: it lists IN_APP rows only.
    const { notifications } = await listNotifications(userA.id);
    expect(notifications.map((n) => n.type).sort()).toEqual([
      "FANOUT_A",
      "FANOUT_DEDUPE",
    ]);
  });

  it("410 deletes the subscription and the row goes DEAD", async () => {
    expect(await alertUser(userA.id, "FANOUT_GONE", "/test-gone")).toBe(true);
    const report = await processPushOutbox(50, new Date(), stubFetch(410));
    expect(report.gone).toBe(1);
    expect(report.dead).toBe(1);
    expect(
      await db.pushSubscription.count({ where: { endpoint: ENDPOINT_A } })
    ).toBe(0);
    // The subscription delete cascades to its outbox rows (same as the
    // integrations outbox): the queue is cleaned, the audit trail is the
    // PUSH FAILED log row, which survives.
    expect(await countOutbox(userA.id)).toBe(0);
    expect(await countPushLogs(userA.id, "FAILED")).toBe(1);
  });

  it("500 retries with backoff and goes DEAD after 5 attempts", async () => {
    await subscribePush(userA.id, { endpoint: ENDPOINT_A, keys: KEYS });
    expect(await alertUser(userA.id, "FANOUT_RETRY", "/test-retry")).toBe(true);
    const start = Date.now();
    // now0 -> attempts 1 (next +2min); +3min -> 2 (+4min); +5min -> 3
    // (+8min); +9min -> 4 (+16min); +17min -> 5 -> DEAD.
    const offsetsMin = [0, 3, 8, 17, 34];
    for (let i = 0; i < offsetsMin.length; i += 1) {
      const now = new Date(start + offsetsMin[i] * 60 * 1000);
      const report = await processPushOutbox(50, now, stubFetch(500));
      expect(report.processed).toBe(1);
      if (i < 4) {
        expect(report.failed).toBe(1);
        expect(report.dead).toBe(0);
      } else {
        expect(report.failed).toBe(0);
        expect(report.dead).toBe(1);
      }
    }
    const row = await db.pushOutbox.findFirst({
      where: { userId: userA.id, type: "FANOUT_RETRY" },
    });
    expect(row!.status).toBe("DEAD");
    expect(row!.attempts).toBe(5);
    expect(await countPushLogs(userA.id, "FAILED")).toBe(1 + 5);
  });

  it("missing VAPID defers the queue without consuming attempts", async () => {
    expect(await alertUser(userA.id, "FANOUT_DEFER", "/test-defer")).toBe(true);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      const report = await processPushOutbox(50, new Date(), stubFetch(201));
      expect(report).toEqual({
        processed: 0,
        sent: 0,
        failed: 0,
        dead: 0,
        gone: 0,
      });
      expect(await countOutbox(userA.id, "PENDING")).toBe(1);
    } finally {
      process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC;
      process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
    }
    const report = await processPushOutbox(50, new Date(), stubFetch(201));
    expect(report.sent).toBe(1);
  });

  it("rate-limit denial defers the row by 60 s without an attempt", async () => {
    await subscribePush(userC.id, { endpoint: ENDPOINT_C, keys: KEYS });
    expect(await alertUser(userC.id, "FANOUT_RL", "/test-rl")).toBe(true);
    for (let i = 0; i < 30; i += 1) {
      await consumeRateLimit(`push:${userC.id}`, 30, 60 * 1000);
    }
    const now = new Date();
    const report = await processPushOutbox(50, now, stubFetch(201));
    expect(report.processed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(0);
    const row = await db.pushOutbox.findFirst({
      where: { userId: userC.id, type: "FANOUT_RL" },
    });
    expect(row!.status).toBe("PENDING");
    expect(row!.attempts).toBe(0);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("push outbox - test send", () => {
  it("sendPushTest sends and logs SENT; 410 deletes the subscription", async () => {
    const ok = await sendPushTest(userA.id, ENDPOINT_A, stubFetch(201));
    expect(ok).toEqual({ ok: true });
    expect(await countPushLogs(userA.id, "SENT")).toBe(4);
    const gone = await sendPushTest(userA.id, ENDPOINT_A, stubFetch(410));
    expect(gone.ok).toBe(false);
    expect(
      await db.pushSubscription.count({ where: { endpoint: ENDPOINT_A } })
    ).toBe(0);
    expect(await countPushLogs(userA.id, "FAILED")).toBe(1 + 5 + 1);
  });

  it("sendPushTest refuses an unknown subscription", async () => {
    const result = await sendPushTest(
      userA.id,
      "https://push.example.com/send/nope",
      stubFetch(201)
    );
    expect(result).toEqual({ ok: false, error: "SUBSCRIPTION_NOT_FOUND" });
  });
});
