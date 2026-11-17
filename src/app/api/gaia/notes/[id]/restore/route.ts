import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, restoreNote } from "@/server/gaia";

/** POST /api/gaia/notes/[id]/restore : sortir une note de la corbeille. */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await restoreNote(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]/restore");
  }
}
