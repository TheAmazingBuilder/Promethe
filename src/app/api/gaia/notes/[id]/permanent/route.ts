import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, purgeNote } from "@/server/gaia";

/** DELETE /api/gaia/notes/[id]/permanent : purge irréversible (depuis la corbeille). */
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await purgeNote(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]/permanent");
  }
}
