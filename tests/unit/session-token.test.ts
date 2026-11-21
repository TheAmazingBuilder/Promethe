import { describe, expect, it } from "vitest";
import {
  hashSessionToken,
  sessionFingerprint,
  storedSessionMatchesToken,
} from "@/lib/auth/session-token";

describe("session token storage", () => {
  const token = "a".repeat(64);

  it("stores a versioned SHA-256 digest, never the raw bearer token", () => {
    const stored = hashSessionToken(token);
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^sha256\$[a-f0-9]{64}$/);
  });

  it("matches both new hashed rows and legacy raw-token rows", () => {
    expect(storedSessionMatchesToken(hashSessionToken(token), token)).toBe(true);
    expect(storedSessionMatchesToken(token, token)).toBe(true);
    expect(storedSessionMatchesToken(hashSessionToken("another"), token)).toBe(false);
  });

  it("keeps the same UI fingerprint before and after legacy migration", () => {
    expect(sessionFingerprint(token)).toBe(sessionFingerprint(hashSessionToken(token)));
  });

  it("does not expose a raw token prefix as the fingerprint", () => {
    expect(sessionFingerprint(token)).not.toBe(token.slice(0, 16));
  });
});
