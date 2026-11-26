/**
 * POST /api/auth/change-password — change the signed-in user's password.
 * Body: { currentPassword, newPassword } (new: 8+ chars, a letter, a digit).
 * 200 { changed: true } · 401 UNAUTHORIZED · 403 BAD_PASSWORD · 422 VALIDATION
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, SESSION_COOKIE, UnauthorizedError } from "@/server/session";
import { apiError } from "@/server/api";
import {
  changePassword,
  changePasswordSchema,
} from "@/server/change-password";
import { zodFieldErrors } from "@/lib/auth/validators";
import { checkReauthRateLimit } from "@/server/reauth-rate-limit";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const jar = await cookies();
    const currentSessionToken = jar.get(SESSION_COOKIE)?.value;
    if (!currentSessionToken) throw new UnauthorizedError();

    const body = await req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
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
    const rateLimit = await checkReauthRateLimit(session.user.id, req.headers);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many password attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const result = await changePassword(
      session.user.id,
      parsed.data,
      currentSessionToken
    );
    if (!result.ok) {
      if (result.code === "BAD_PASSWORD") {
        return NextResponse.json(
          { error: "BAD_PASSWORD", message: "Incorrect current password." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Account not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ changed: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session missing or expired." },
        { status: 401 }
      );
    }
    return apiError(error, "auth/change-password");
  }
}
