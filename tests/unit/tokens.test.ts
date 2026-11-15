/**
 * v3 Phase 1 — Token utilities unit tests.
 *
 * Verifies: 256-bit generation, HMAC hashing with pepper, constant-time
 * comparison, display prefixes, IP pseudonymisation and stability.
 */
import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  generateToken,
  hashIp,
  hashToken,
  hashUserId,
  tokenMatches,
  tokenPepper,
  tokenPrefixOf,
} from "@/lib/tokens";

describe("generateToken", () => {
  it("produces URL-safe tokens of the expected entropy", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
    expect(generateToken()).not.toBe(generateToken());
  });

  it("honours a custom byte length", () => {
    expect(generateToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("hashToken", () => {
  it("is deterministic and peppered (not plain SHA-256)", async () => {
    const token = generateToken();
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    // Not a bare sha256 of the token: pepper must be involved.
    const { createHash } = await import("node:crypto");
    expect(hash1).not.toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("changes completely with the token (avalanche)", () => {
    const a = hashToken("tj_token_A");
    const b = hashToken("tj_token_B");
    expect(a).not.toBe(b);
  });

  it("never contains the raw token", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token.slice(0, 12));
  });
});

describe("constantTimeEqual / tokenMatches", () => {
  it("matches identical strings and rejects different ones", () => {
    expect(constantTimeEqual("abcdef", "abcdef")).toBe(true);
    expect(constantTimeEqual("abcdef", "abcdeg")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("tokenMatches verifies raw candidate against stored hash", () => {
    const token = generateToken();
    const stored = hashToken(token);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(generateToken(), stored)).toBe(false);
  });
});

describe("tokenPrefixOf", () => {
  it("returns the first 6 chars for display", () => {
    expect(tokenPrefixOf("abcdefghij")).toBe("abcdef");
    expect(tokenPrefixOf("abcdefghij", 4)).toBe("abcd");
  });
});

describe("hashIp", () => {
  it("pseudonymises IPs deterministically without storing them raw", () => {
    const h1 = hashIp("203.0.113.42");
    const h2 = hashIp("203.0.113.42");
    const h3 = hashIp("203.0.113.43");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(h1).not.toContain("203.0.113");
  });
});

describe("hashUserId", () => {
  it("produces a stable non-personal tombstone id", () => {
    const id = "user_cuid_123";
    expect(hashUserId(id)).toBe(hashUserId(id));
    expect(hashUserId(id)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserId(id)).not.toContain(id);
  });
});

describe("tokenPepper", () => {
  it("is loaded from the environment (vitest sets a deterministic value)", () => {
    expect(tokenPepper()).toBe("test-token-pepper-0123456789abcdef");
  });
});
