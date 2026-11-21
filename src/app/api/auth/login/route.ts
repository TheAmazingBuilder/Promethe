import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { loginSchema, zodFieldErrors } from "@/lib/auth/validators";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, hashRateLimitIdentifier } from "@/lib/tokens";
import { createSession } from "@/server/session";
import { ensureUserSetup } from "@/server/users";

/** Precomputed hash so a missing account costs the same as a wrong password. */
const DUMMY_HASH = hashPassword("comparaison-temps-constant");

/**
 * POST /api/auth/login
 * 200 { user, profile } · 401 INVALID_CREDENTIALS · 422 VALIDATION · 429 RATE_LIMITED · 500
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }

    const { email, password } = parsed.data;

    const [emailLimit, ipLimit] = await Promise.all([
      consumeRateLimit(
        `auth:login:email:${hashRateLimitIdentifier("auth-login-email", email)}`,
        10,
        5 * 60 * 1000
      ),
      consumeRateLimit(
        `auth:login:ip:${hashRateLimitIdentifier("auth-login-ip", clientIpFrom(req.headers))}`,
        30,
        5 * 60 * 1000
      ),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: "Too many attempts. Please try again in a few minutes.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil((Math.max(emailLimit.resetAt, ipLimit.resetAt) - Date.now()) / 1000))) },
        }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return NextResponse.json(
        {
          error: "INVALID_CREDENTIALS",
          message: "Incorrect email or password.",
        },
        { status: 401 }
      );
    }

    const session = await ensureUserSetup(user.id);
    await createSession(user.id);

    // Opportunistic purge of expired sessions (cheap, keeps the table small).
    await db.authSession
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    return NextResponse.json(session);
  } catch (error) {
    console.error("[api/auth/login] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
