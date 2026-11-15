/**
 * v3 — Secret token utilities (SERVER-ONLY — never import from client code).
 *
 * Security model (v3 §1):
 *  - Raw tokens (EA connection tokens, share tokens, invitation tokens) are
 *    256-bit, URL-safe, shown ONCE at creation, never logged.
 *  - Stored as HMAC-SHA256(raw token, TOKEN_PEPPER) — pepper never leaves the
 *    server, so a DB leak alone cannot forge or brute-force tokens.
 *  - Lookups compare hashes in constant time (timingSafeEqual) so probing a
 *    valid prefix gains no timing signal.
 *  - IP addresses are never stored raw: rate limiting and view counting use
 *    HMAC-SHA256(ip, IP_HASH_PEPPER).
 */
import {
  createHmac,
  randomBytes,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";

const TOKEN_PEPPER_ENV = "TOKEN_PEPPER";
const IP_PEPPER_ENV = "IP_HASH_PEPPER";

function requirePepper(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(
      `${name} is missing or too short (< 16 chars) — set it in .env before running v3 features.`
    );
  }
  return value;
}

/**
 * Pepper for token hashing. Exposed for tests (deterministic values) only —
 * production values come exclusively from the environment.
 */
export function tokenPepper(): string {
  return requirePepper(TOKEN_PEPPER_ENV);
}

/** Generates a 256-bit URL-safe random token (base64url, no padding). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** HMAC-SHA256(raw, TOKEN_PEPPER) → hex. What gets stored in the DB. */
export function hashToken(token: string): string {
  return createHmac("sha256", tokenPepper()).update(token).digest("hex");
}

/** Display prefix of a raw token ("tj_a1b2…"): first 6 chars, no secrets. */
export function tokenPrefixOf(token: string, length = 6): string {
  return token.slice(0, length);
}

/** Constant-time string equality — no early exit on first differing byte. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing uniform, then fail.
    nodeTimingSafeEqual(bufA, bufA);
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}

/** Constant-time comparison of a raw candidate against a stored hash. */
export function tokenMatches(rawCandidate: string, storedHash: string): boolean {
  return constantTimeEqual(hashToken(rawCandidate), storedHash);
}

/**
 * Pseudonymised IP for rate limiting / view counting. Truncates the HMAC so
 * the full digest cannot be reversed against a small candidate set, and so
 * the stored value is useless outside this app's comparisons.
 */
export function hashIp(ip: string): string {
  const pepper = requirePepper(IP_PEPPER_ENV);
  return createHmac("sha256", pepper).update(ip).digest("hex").slice(0, 32);
}

/** Extracts a best-effort client IP from proxy headers (x-forwarded-for). */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * Hashes a user id for the post-deletion audit tombstone — irreversible
 * without the pepper, preserves nothing personal.
 */
export function hashUserId(userId: string): string {
  return createHmac("sha256", tokenPepper()).update(userId).digest("hex");
}
