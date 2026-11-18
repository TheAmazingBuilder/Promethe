import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteSetup, updateSetup } from "@/server/playbook";
import { setupPatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/setups/[id] — strategyId cannot change (a setup belongs to
 *        one strategy; duplicate it instead).
 * DELETE /api/setups/[id] — trades keep history (setupId is SetNull).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = setupPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const setup = await updateSetup(session.user.id, id, parsed.data);
    if (!setup) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Setup not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ setup });
  } catch (error) {
    return apiError(error, "setups/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteSetup(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Setup not found." },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "setups/[id]");
  }
}
