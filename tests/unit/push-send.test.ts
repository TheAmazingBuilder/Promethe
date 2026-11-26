/**
 * Web Push sender (§25.4) - outcomes of sendWebPush() with a stubbed
 * fetch: no network is ever touched. The sender encrypts with the
 * throwaway VAPID pair set in-process (env read at call time).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { sendWebPush } from "@/lib/push/send";
import { toBase64Url } from "@/lib/push/vapid";

const vapid = createECDH("prime256v1");
vapid.generateKeys();
const VAPID_PUBLIC = toBase64Url(vapid.getPublicKey(null, "uncompressed"));
const VAPID_PRIVATE = toBase64Url(vapid.getPrivateKey());

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const SUBSCRIPTION = {
  endpoint: "https://push.example.com/send/abc",
  p256dh: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
  auth: toBase64Url(Buffer.from("0123456789abcdef", "utf8")),
};

function stubFetch(status: number, retryAfter?: string): typeof fetch {
  return (async () =>
    ({
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("push send", () => {
  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", VAPID_PUBLIC);
    vi.stubEnv("VAPID_PRIVATE_KEY", VAPID_PRIVATE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("201 is ok and sends an encrypted aes128gcm body with VAPID headers", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 201,
        headers: { get: () => null },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const outcome = await sendWebPush({
      subscription: SUBSCRIPTION,
      payload: { title: "Hello", body: "World", url: "/dashboard" },
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(SUBSCRIPTION.endpoint);
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
    });
    const auth = (seen[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/);
    // Encrypted body: 86-octet header + ciphertext (never the plaintext).
    const body = seen[0].init.body as Buffer;
    expect(body.length).toBeGreaterThan(86);
    expect(body.toString("utf8")).not.toContain("Hello");
    expect(body.toString("utf8")).not.toContain("World");
  });

  it("410 and 404 mark the subscription gone", async () => {
    for (const status of [410, 404]) {
      const outcome = await sendWebPush({
        subscription: SUBSCRIPTION,
        payload: { title: "T", body: "B" },
        fetchImpl: stubFetch(status),
      });
      expect(outcome).toEqual({
        ok: false,
        gone: true,
        error: `SUBSCRIPTION_GONE (${status})`,
      });
    }
  });

  it("429 returns the Retry-After delay, capped at one hour, default 60 s", async () => {
    expect(
      await sendWebPush({
        subscription: SUBSCRIPTION,
        payload: { title: "T", body: "B" },
        fetchImpl: stubFetch(429, "120"),
      })
    ).toEqual({ ok: false, error: "RATE_LIMITED (429)", retryAfterSeconds: 120 });
    expect(
      await sendWebPush({
        subscription: SUBSCRIPTION,
        payload: { title: "T", body: "B" },
        fetchImpl: stubFetch(429),
      })
    ).toEqual({ ok: false, error: "RATE_LIMITED (429)", retryAfterSeconds: 60 });
    expect(
      await sendWebPush({
        subscription: SUBSCRIPTION,
        payload: { title: "T", body: "B" },
        fetchImpl: stubFetch(429, "99999"),
      })
    ).toEqual({ ok: false, error: "RATE_LIMITED (429)", retryAfterSeconds: 3600 });
  });

  it("500 is a retryable error without a delay", async () => {
    const outcome = await sendWebPush({
      subscription: SUBSCRIPTION,
      payload: { title: "T", body: "B" },
      fetchImpl: stubFetch(500),
    });
    expect(outcome).toEqual({ ok: false, error: "PUSH_FAILED (500)" });
  });

  it("a network failure is a retryable error", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const outcome = await sendWebPush({
      subscription: SUBSCRIPTION,
      payload: { title: "T", body: "B" },
      fetchImpl,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("NETWORK_ERROR");
  });

  it("a bad subscription key is a hard error (no send attempted)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await sendWebPush({
      subscription: { ...SUBSCRIPTION, p256dh: toBase64Url(Buffer.alloc(10)) },
      payload: { title: "T", body: "B" },
      fetchImpl,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("ENCRYPTION_FAILED");
      expect(outcome.error).toContain("INVALID_P256DH");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("missing VAPID keys refuse to send", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await sendWebPush({
      subscription: SUBSCRIPTION,
      payload: { title: "T", body: "B" },
      fetchImpl,
    });
    expect(outcome).toEqual({ ok: false, error: "VAPID_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
