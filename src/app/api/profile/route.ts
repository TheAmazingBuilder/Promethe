import { NextResponse } from "next/server";
import { updateProfileSchema, zodFieldErrors } from "@/lib/auth/validators";
import { requireUser, UnauthorizedError } from "@/server/session";
import { updateProfile } from "@/server/users";

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
          message: "Certains champs sont invalides.",
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
        { error: "UNAUTHORIZED", message: "Session absente ou expirée." },
        { status: 401 }
      );
    }
    console.error("[api/profile] PATCH failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "Une erreur est survenue. Réessayez." },
      { status: 500 }
    );
  }
}
