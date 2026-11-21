import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signupSchema, zodFieldErrors } from "@/lib/auth/validators";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, hashRateLimitIdentifier } from "@/lib/tokens";
import { createSession } from "@/server/session";
import { createUserWithDefaults } from "@/server/users";

/**
 * POST /api/auth/signup
 * 201 { user, profile } · 409 EMAIL_TAKEN · 422 VALIDATION · 429 RATE_LIMITED · 500
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
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
    const displayName =
      parsed.data.displayName?.trim() ||
      email.split("@")[0].slice(0, 60) ||
      "Trader";
    const timezone = parsed.data.timezone || "UTC";
    const locale = parsed.data.locale || "en";

    const [emailLimit, ipLimit] = await Promise.all([
      consumeRateLimit(
        `auth:signup:email:${hashRateLimitIdentifier("auth-signup-email", email)}`,
        5,
        15 * 60 * 1000
      ),
      consumeRateLimit(
        `auth:signup:ip:${hashRateLimitIdentifier("auth-signup-ip", clientIpFrom(req.headers))}`,
        20,
        15 * 60 * 1000
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

    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "EMAIL_TAKEN", message: "An account already exists with this email." },
        { status: 409 }
      );
    }

    const session = await createUserWithDefaults({
      email,
      password,
      displayName,
      timezone,
      baseCurrency: "USD",
      locale,
    });
    await createSession(session.user.id);

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    // Unique-constraint race → same message as the pre-check.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return NextResponse.json(
        { error: "EMAIL_TAKEN", message: "An account already exists with this email." },
        { status: 409 }
      );
    }
    console.error("[api/auth/signup] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
