import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { loginSchema, zodFieldErrors } from "@/lib/auth/validators";
import { rateLimit } from "@/lib/rate-limit";
import { createSession } from "@/server/session";
import { ensureUserSetup } from "@/server/users";
import { LOCALE_COOKIE, isAppLocale } from "@/i18n/config";

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
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }

    const { email, password } = parsed.data;

    if (!rateLimit(`login:${email}`, 10, 5 * 60 * 1000)) {
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: "Trop de tentatives. Réessayez dans quelques minutes.",
        },
        { status: 429 }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return NextResponse.json(
        {
          error: "INVALID_CREDENTIALS",
          message: "Courriel ou mot de passe incorrect.",
        },
        { status: 401 }
      );
    }

    const session = await ensureUserSetup(user.id);
    await createSession(user.id);

    // Cross-device locale sync: the profile's locale wins over the cookie.
    if (isAppLocale(session.profile.locale)) {
      const jar = await cookies();
      jar.set(LOCALE_COOKIE, session.profile.locale, {
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
        sameSite: "lax",
      });
    }

    // Opportunistic purge of expired sessions (cheap, keeps the table small).
    await db.authSession
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    return NextResponse.json(session);
  } catch (error) {
    console.error("[api/auth/login] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "Une erreur est survenue. Réessayez." },
      { status: 500 }
    );
  }
}
