/**
 * Rate limiting (v3 §1):
 *  - In-memory fixed window (v1) — cheap guard for auth-sensitive routes in
 *    the single-process sandbox.
 *  - DB-backed RateLimitBucket (v3) — durable, survives restarts, used by the
 *    ingest endpoint, public share views, invitations and comments. Keys are
 *    ALWAYS pre-hashed (token hash / HMAC of IP) — no raw identifiers stored.
 *
 * Free-tier note: no Redis — a single SQLite/Postgres table with atomic
 * upserts. Pruned by the daily cron.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Minimal fixed-window in-memory rate limiter.
 * Single-process friendly (sandbox / Vercel Hobby single instance) — swap for
 * Upstash or Redis when scaling horizontally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true when the request is allowed, false when the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Housekeeping: drop expired buckets (called occasionally). */
export function sweepRateLimits(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// ── v3 — DB-backed buckets ───────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining allowance in the current window (0 when denied). */
  remaining: number;
  /** Epoch ms when the current window resets (retry-after hint). */
  resetAt: number;
}

/**
 * Consumes one unit from the fixed-window bucket `key` (already hashed).
 *
 * Race-safe without transactions:
 *  1. increment a live, non-full bucket  → allowed
 *  2. reset an expired bucket            → allowed (new window)
 *  3. create the bucket (unique key)     → allowed (first hit)
 *  4. none matched                       → denied (full window)
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  // 1. Live bucket with remaining allowance.
  const incremented = await db.rateLimitBucket.updateMany({
    where: { key, count: { lt: limit }, windowStart: { gt: cutoff } },
    data: { count: { increment: 1 } },
  });
  if (incremented.count > 0) {
    const bucket = await db.rateLimitBucket.findUnique({ where: { key } });
    return {
      allowed: true,
      remaining: Math.max(0, limit - (bucket?.count ?? limit)),
      resetAt: (bucket?.windowStart ?? now).getTime() + windowMs,
    };
  }

  // 2. Expired bucket → fresh window.
  const reset = await db.rateLimitBucket.updateMany({
    where: { key, windowStart: { lte: cutoff } },
    data: { count: 1, windowStart: now },
  });
  if (reset.count > 0) {
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: now.getTime() + windowMs };
  }

  // 3. First hit for this key.
  try {
    await db.rateLimitBucket.create({ data: { key, windowStart: now, count: 1 } });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: now.getTime() + windowMs };
  } catch (error) {
    // Unique conflict → bucket exists, window fresh and full → denied.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const bucket = await db.rateLimitBucket.findUnique({ where: { key } });
      return {
        allowed: false,
        remaining: 0,
        resetAt: (bucket?.windowStart ?? now).getTime() + windowMs,
      };
    }
    throw error;
  }
}

/** Reads the current bucket without consuming (diagnostics / tests). */
export async function peekRateLimit(
  key: string
): Promise<{ count: number; windowStart: Date } | null> {
  return db.rateLimitBucket.findUnique({ where: { key } });
}

/** Daily cron step: drop buckets whose window ended long ago. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const removed = await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return removed.count;
}
