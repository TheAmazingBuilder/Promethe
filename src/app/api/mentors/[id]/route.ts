/**
 * PATCH  /api/mentors/[id] — edit scope / pause / resume (owner only).
 * DELETE /api/mentors/[id] — revoke immediately; the mentor's next request
 *                            fails with ACCESS_DENIED (nothing is cached).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { revokeAccess, updateAccess } from "@/server/mentors";
import { mentorAccessPatchSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = mentorAccessPatchSchema.safeParse(body);
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
    const access = await updateAccess(session.user.id, id, parsed.data);
    return NextResponse.json({ access });
  } catch (error) {
    return apiError(error, "mentors/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    await revokeAccess(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "mentors/[id]");
  }
}
