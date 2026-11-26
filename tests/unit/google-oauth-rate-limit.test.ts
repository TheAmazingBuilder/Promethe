import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  new URL("../../src/app/api/auth/google/route.ts", import.meta.url),
  "utf8"
);

describe("Google OAuth initiation throttling", () => {
  it("consumes a durable per-IP bucket before creating an OAuth state", () => {
    expect(route).toContain("consumeRateLimit(");
    expect(route).toContain("hashRateLimitIdentifier");
    expect(route).toContain("AUTH_RATE_LIMITS.google.ip");
    expect(route).toContain('status: 429');
    expect(route).toContain('"Retry-After"');
  });
});
