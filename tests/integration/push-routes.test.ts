/**
 * Web Push routes (§25.4) - validation, ownership and availability at
 * the HTTP layer: POST / DELETE /api/push/subscribe, POST /api/push/test,
 * GET /api/push/config. The test button's real send is covered with a
 * stubbed fetch in tests/integration/push-outbox.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name)
        ? { name, value: cookieStore.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createSession } from "@/server/session";
import { toBase64Url } from "@/lib/push/vapid";
import { GET as getConfig } from "@/app/api/push/config/route";
import {
  DELETE as deleteSubscribe,
  POST as postSubscribe,
} from "@/app/api/push/subscribe/route";
import { POST as postTest } from "@/app/api/push/test/route";

let userA: { id: string };
let userB: { id: string };

const vapid = createECDH("prime256v1");
vapid.generateKeys();
const VAPID_PUBLIC = toBase64Url(vapid.getPublicKey(null, "uncompressed"));
const VAPID_PRIVATE = toBase64Url(vapid.getPrivateKey());

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const VALID_BODY = {
  endpoint: "https://push.example.com/send/route-device",
  keys: {
    p256dh: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
    auth: toBase64Url(Buffer.from("0123456789abcdef", "utf8")),
  },
};

async function loginAs(userId: string) {
  cookieStore.clear();
  await createSession(userId);
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

function request(body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID_PUBLIC;
  const a = await createUserWithDefaults({
    email: "push-route-a@test.local",
    password: "Test1234!",
    displayName: "Push Route A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "push-route-b@test.local",
    password: "Test1234!",
    displayName: "Push Route B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;
});

afterAll(async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("push routes - config", () => {
  it("reports available when the VAPID keys are set", async () => {
    await loginAs(userA.id);
    const res = await getConfig();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ available: true });
  });

  it("reports unavailable when the keys are missing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    try {
      await loginAs(userA.id);
      const res = await getConfig();
      expect(await json(res)).toEqual({ available: false });
    } finally {
      process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC;
      process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID_PUBLIC;
    }
  });

  it("requires authentication", async () => {
    cookieStore.clear();
    const res = await getConfig();
    expect(res.status).toBe(401);
  });
});

describe("push routes - subscribe", () => {
  it("refuses an invalid subscription payload with 422", async () => {
    await loginAs(userA.id);
    const bad = await postSubscribe(
      request({ endpoint: "http://not-https.example.com/x", keys: VALID_BODY.keys })
    );
    expect(bad.status).toBe(422);
    expect((await json(bad)).error).toBe("VALIDATION");
    const shortKey = await postSubscribe(
      request({
        endpoint: VALID_BODY.endpoint,
        keys: { p256dh: "AAAA", auth: VALID_BODY.keys.auth },
      })
    );
    expect(shortKey.status).toBe(422);
  });

  it("subscribes (201), re-subscribing stays one row, then unsubscribes", async () => {
    await loginAs(userA.id);
    const first = await postSubscribe(request(VALID_BODY));
    expect(first.status).toBe(201);
    const firstBody = await json(first);
    expect((firstBody.subscription as { endpoint: string }).endpoint).toBe(
      VALID_BODY.endpoint
    );
    const again = await postSubscribe(request(VALID_BODY));
    expect(again.status).toBe(201);
    expect(
      await db.pushSubscription.count({
        where: { endpoint: VALID_BODY.endpoint },
      })
    ).toBe(1);

    // Another user cannot remove this row.
    await loginAs(userB.id);
    const foreign = await deleteSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
      })
    );
    expect((await json(foreign)).removed).toBe(false);
    expect(
      await db.pushSubscription.count({
        where: { endpoint: VALID_BODY.endpoint },
      })
    ).toBe(1);

    await loginAs(userA.id);
    const removed = await deleteSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
      })
    );
    expect((await json(removed)).removed).toBe(true);
    const removedAgain = await deleteSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: VALID_BODY.endpoint }),
      })
    );
    expect((await json(removedAgain)).removed).toBe(false);
  });

  it("refuses to subscribe when VAPID is not configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      await loginAs(userA.id);
      const res = await postSubscribe(request(VALID_BODY));
      expect(res.status).toBe(503);
    } finally {
      process.env.VAPID_PUBLIC_KEY = VAPID_PUBLIC;
      process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
    }
  });
});

describe("push routes - test", () => {
  it("refuses a test for an unknown subscription", async () => {
    await loginAs(userA.id);
    const res = await postTest(
      new Request("http://localhost/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/send/nope" }),
      })
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toBe("SUBSCRIPTION_NOT_FOUND");
  });
});
