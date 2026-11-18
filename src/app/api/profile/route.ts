import { NextResponse } from "next/server";
import { updateProfileSchema, zodFieldErrors } from "@/lib/auth/validators";
import { requireUser, UnauthorizedError } from "@/server/session";
import { updateProfile } from "@/server/users";
import { db } from "@/lib/db";

/**
 * GET /api/profile — current user + profile, including the sign-up date
 * (createdAt), which the session payload does not carry. The profile page
 * header uses it for "Member since".
 * 200 { user: { id, email, createdAt }, profile } · 401 UNAUTHORIZED
 */
export async function GET() {
  try {
    const session = await requireUser();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdAt: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Account not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ...session,
      user: { ...session.user, createdAt: user.createdAt.toISOString() },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session missing or expired." },
        { status: 401 }
      );
    }
    console.error("[api/profile] GET failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/profile — partial profile update (locale, theme, display name,
 * timezone, base currency). The row is keyed by the SESSION user id — a
 * client can never target another user's profile.
 * 200 { user, profile } · 401 UNAUTHORIZED · 422 VALIDATION · 500
 */
export async function PATCH(req: Request) {
  try {
    const session = await requireUser();

    const body = await req.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(body);
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

    const updated = await updateProfile(session.user.id, parsed.data);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session missing or expired." },
        { status: 401 }
      );
    }
    console.error("[api/profile] PATCH failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
