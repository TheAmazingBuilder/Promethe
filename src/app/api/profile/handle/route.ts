/**
 * GET /api/profile/handle — suggest an available handle (nothing persisted).
 * PUT /api/profile/handle — reserve the handle (+ optional public name).
 * The handle is required before inviting mentors or being mentioned.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { setHandle, suggestHandle } from "@/server/users";
import { handlePatchSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const suggestion = await suggestHandle(session.user.id);
    return NextResponse.json({ suggestion });
  } catch (error) {
    return apiError(error, "profile/handle");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = handlePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Handle invalide (a-z, 0-9, _, 3-24 caractères).",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const updated = await setHandle(
      session.user.id,
      parsed.data.handle,
      parsed.data.publicDisplayName ?? undefined
    );
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error, "profile/handle");
  }
}
