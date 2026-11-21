import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));

import { checkReauthRateLimit } from "@/server/reauth-rate-limit";

describe("checkReauthRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ allowed: true, remaining: 29, resetAt: Date.now() + 30_000 });
  });

  it("consumes both a pseudonymized user bucket and a pseudonymized IP bucket", async () => {
    const result = await checkReauthRateLimit(
      "user-1",
      new Headers({ "x-forwarded-for": "203.0.113.42" })
    );

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    const keys = mocks.consumeRateLimit.mock.calls.map((call) => call[0]);
    expect(keys[0]).toMatch(/^reauth:user:[0-9a-f]{32}$/);
    expect(keys[1]).toMatch(/^reauth:ip:[0-9a-f]{32}$/);
    expect(keys.join(" ")).not.toContain("user-1");
    expect(keys.join(" ")).not.toContain("203.0.113.42");
  });

  it("denies the request when either bucket is exhausted", async () => {
    mocks.consumeRateLimit
      .mockReset()
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 90_000 })
      .mockResolvedValueOnce({ allowed: true, remaining: 29, resetAt: Date.now() + 30_000 });

    const result = await checkReauthRateLimit(
      "user-1",
      new Headers({ "x-forwarded-for": "203.0.113.42" })
    );

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
