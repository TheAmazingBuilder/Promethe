/**
 * Session-token storage helpers.
 *
 * Cookies keep the raw 256-bit bearer token; the database stores only a
 * versioned SHA-256 digest. The prefix makes legacy raw-token rows
 * distinguishable during the one-time lazy migration.
 */
import { createHash } from "node:crypto";

const SESSION_HASH_PREFIX = "sha256$";

export function hashSessionToken(token: string): string {
  return SESSION_HASH_PREFIX + createHash("sha256").update(token).digest("hex");
}

/** Stable short fingerprint for the session-management UI. */
export function sessionFingerprint(storedId: string): string {
  if (storedId.startsWith(SESSION_HASH_PREFIX)) {
    return storedId.slice(SESSION_HASH_PREFIX.length, SESSION_HASH_PREFIX.length + 16);
  }
  // Legacy rows stored the raw bearer token; never expose a raw-token prefix.
  return createHash("sha256").update(storedId).digest("hex").slice(0, 16);
}

/** Compare a stored row id against a raw cookie token, including legacy rows. */
export function storedSessionMatchesToken(storedId: string, token: string): boolean {
  return storedId === hashSessionToken(token) || storedId === token;
}
