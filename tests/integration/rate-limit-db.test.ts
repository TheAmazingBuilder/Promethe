/**
 * v3 Phase 1 — DB-backed rate limiter integration tests (PostgreSQL schema promethe_test).
 *
 * Verifies the fixed-window semantics: allow up to the limit, deny past it,
 * reset after the window elapses, independent buckets per key, and pruning.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { consumeRateLimit, peekRateLimit, pruneRateLimits } from "@/lib/rate-limit";

const WINDOW_MS = 200;
const LIMIT = 3;

beforeAll(async () => {
  await db.rateLimitBucket.deleteMany({});
});

afterAll(async () => {
  await db.rateLimitBucket.deleteMany({});
  await db.$disconnect();
});

describe("consumeRateLimit", () => {
  it("allows up to the limit then denies with remaining 0", async () => {
    const key = "rl_test_a";
    const first = await consumeRateLimit(key, LIMIT, WINDOW_MS);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(LIMIT - 1);

    await consumeRateLimit(key, LIMIT, WINDOW_MS);
    const third = await consumeRateLimit(key, LIMIT, WINDOW_MS);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await consumeRateLimit(key, LIMIT, WINDOW_MS);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("resets the window after it elapses", async () => {
    const key = "rl_test_b";
    for (let i = 0; i < LIMIT; i++) {
      await consumeRateLimit(key, LIMIT, WINDOW_MS);
    }
    expect((await consumeRateLimit(key, LIMIT, WINDOW_MS)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 30));
    const after = await consumeRateLimit(key, LIMIT, WINDOW_MS);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(LIMIT - 1);
  });

  it("keeps keys independent", async () => {
    const a = await consumeRateLimit("rl_test_c", 1, 60_000);
    const b = await consumeRateLimit("rl_test_d", 1, 60_000);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect((await consumeRateLimit("rl_test_c", 1, 60_000)).allowed).toBe(false);
    expect((await consumeRateLimit("rl_test_d", 1, 60_000)).allowed).toBe(false);
  });

  it("stores hashed keys only (no raw identifiers by contract)", async () => {
    const hashedKey = "deadbeefdeadbeefdeadbeefdeadbeef"; // pre-hashed by caller
    await consumeRateLimit(hashedKey, 10, 60_000);
    const bucket = await peekRateLimit(hashedKey);
    expect(bucket).not.toBeNull();
    expect(bucket?.count).toBe(1);
  });
});

describe("pruneRateLimits", () => {
  it("removes expired buckets", async () => {
    await db.rateLimitBucket.create({
      data: { key: "rl_old", windowStart: new Date(Date.now() - 48 * 3600_000), count: 5 },
    });
    const removed = await pruneRateLimits(24 * 3600_000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await peekRateLimit("rl_old")).toBeNull();
    // Fresh buckets survive.
    expect(await peekRateLimit("rl_test_c")).not.toBeNull();
  });
});
