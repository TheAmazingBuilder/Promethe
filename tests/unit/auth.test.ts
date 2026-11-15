/**
 * Unit tests — password hashing (scrypt) and the fixed-window rate limiter.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";

describe("password (scrypt)", () => {
  it("hash → verify roundtrip", () => {
    const hash = hashPassword("correct horse battery 7");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery 7", hash)).toBe(true);
  });

  it("wrong password fails", () => {
    const hash = hashPassword("correct horse battery 7");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("per-password salt: two hashes of the same password differ", () => {
    const a = hashPassword("same-password-1");
    const b = hashPassword("same-password-1");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password-1", a)).toBe(true);
    expect(verifyPassword("same-password-1", b)).toBe(true);
  });

  it("malformed stored hash never verifies (and never throws)", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "scrypt$zz$zz")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});

describe("rateLimit (fixed window)", () => {
  it("allows up to the limit then blocks", () => {
    sweepRateLimits();
    expect(rateLimit("k", 2, 1000)).toBe(true);
    expect(rateLimit("k", 2, 1000)).toBe(true);
    expect(rateLimit("k", 2, 1000)).toBe(false);
  });

  it("different keys are independent", () => {
    expect(rateLimit("a", 1, 1000)).toBe(true);
    expect(rateLimit("b", 1, 1000)).toBe(true);
    expect(rateLimit("a", 1, 1000)).toBe(false);
  });

  it("the window resets after expiry", async () => {
    sweepRateLimits();
    expect(rateLimit("reset-k", 1, 25)).toBe(true);
    expect(rateLimit("reset-k", 1, 25)).toBe(false);
    // Wait past the (short) window — a real sleep is more robust than
    // faking Date.now(), which the limiter reads directly.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rateLimit("reset-k", 1, 25)).toBe(true);
  });
});
