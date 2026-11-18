/**
 * POST /api/auth/change-password — change the signed-in user's password.
 * Body: { currentPassword, newPassword } (new: 8+ chars, a letter, a digit).
 * 200 { changed: true } · 401 UNAUTHORIZED · 403 BAD_PASSWORD · 422 VALIDATION
 */
import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/server/session";
import { apiError } from "@/server/api";
import {
  changePassword,
  changePasswordSchema,
} from "@/server/change-password";
import { zodFieldErrors } from "@/lib/auth/validators";

export async function POST(req: Request) {
  try {
    const session = await requireUser();
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
    const result = await changePassword(session.user.id, parsed.data);
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
