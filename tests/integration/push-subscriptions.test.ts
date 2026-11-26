/**
 * Web Push subscriptions (§25.4) - one row per device, ownership
 * enforced. A repeated subscribe never duplicates the row; an endpoint
 * transfers to the latest subscriber; a user can only remove their own
 * rows. (Payload shape validation lives at the route layer -
 * tests/integration/push-routes.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createECDH } from "node:crypto";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { toBase64Url } from "@/lib/push/vapid";
import {
  getOwnPushSubscription,
  subscribePush,
  unsubscribePush,
} from "@/server/push/subscriptions";

let userA: { id: string };
let userB: { id: string };

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const PAYLOAD = {
  endpoint: "https://push.example.com/send/device-1",
  keys: {
    p256dh: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
    auth: toBase64Url(Buffer.from("0123456789abcdef", "utf8")),
  },
};

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "push-sub-a@test.local",
    password: "Test1234!",
    displayName: "Push A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "push-sub-b@test.local",
    password: "Test1234!",
    displayName: "Push B",
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

describe("push subscriptions", () => {
  it("subscribes, then re-subscribing the same endpoint keeps one row", async () => {
    const first = await subscribePush(userA.id, PAYLOAD, "TestAgent/1.0");
    const again = await subscribePush(userA.id, PAYLOAD, "TestAgent/1.0");
    expect(again.id).toBe(first.id);
    expect(
      await db.pushSubscription.count({ where: { endpoint: PAYLOAD.endpoint } })
    ).toBe(1);

    // lastSeenAt refreshes on re-subscribe (forced back, then bumped).
    await db.pushSubscription.update({
      where: { id: first.id },
      data: { lastSeenAt: new Date(Date.now() - 60_000) },
    });
    const refreshed = await subscribePush(userA.id, PAYLOAD, "TestAgent/1.0");
    expect(new Date(refreshed.lastSeenAt).getTime()).toBeGreaterThan(
      Date.now() - 5_000
    );
  });

  it("the endpoint transfers to the latest subscriber", async () => {
    await subscribePush(userB.id, PAYLOAD, "TestAgent/2.0");
    const rows = await db.pushSubscription.findMany({
      where: { endpoint: PAYLOAD.endpoint },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userB.id);
    expect(await getOwnPushSubscription(userB.id, PAYLOAD.endpoint)).not.toBeNull();
    expect(await getOwnPushSubscription(userA.id, PAYLOAD.endpoint)).toBeNull();
  });

  it("unsubscribe only removes the owner's own row", async () => {
    expect(await unsubscribePush(userA.id, PAYLOAD.endpoint)).toBe(false);
    expect(
      await db.pushSubscription.count({ where: { endpoint: PAYLOAD.endpoint } })
    ).toBe(1);
    expect(await unsubscribePush(userB.id, PAYLOAD.endpoint)).toBe(true);
    expect(
      await db.pushSubscription.count({ where: { endpoint: PAYLOAD.endpoint } })
    ).toBe(0);
    expect(await unsubscribePush(userB.id, PAYLOAD.endpoint)).toBe(false);
  });
});
