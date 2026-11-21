import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, hashRateLimitIdentifier } from "@/lib/tokens";

const REAUTH_USER_LIMIT = 5;
const REAUTH_IP_LIMIT = 30;
const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export interface ReauthRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Shared durable throttle for password re-authentication endpoints.
 * User and IP identifiers are HMAC-pseudonymized before reaching PostgreSQL.
 */
export async function checkReauthRateLimit(
  userId: string,
  headers: Headers
): Promise<ReauthRateLimitResult> {
  const [userLimit, ipLimit] = await Promise.all([
    consumeRateLimit(
      `reauth:user:${hashRateLimitIdentifier("reauth-user", userId)}`,
      REAUTH_USER_LIMIT,
      REAUTH_WINDOW_MS
    ),
    consumeRateLimit(
      `reauth:ip:${hashRateLimitIdentifier("reauth-ip", clientIpFrom(headers))}`,
      REAUTH_IP_LIMIT,
      REAUTH_WINDOW_MS
    ),
  ]);

  const resetAt = Math.max(userLimit.resetAt, ipLimit.resetAt);
  return {
    allowed: userLimit.allowed && ipLimit.allowed,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}
