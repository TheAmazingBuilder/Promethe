import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteFolder, gaiaErrorResponse, updateFolder } from "@/server/gaia";

/**
 * PATCH  /api/gaia/folders/[id] : renommer un dossier.
 * DELETE /api/gaia/folders/[id] : supprimer (ses notes passent à "Sans dossier").
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const result = await updateFolder(session.user.id, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/folders/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await deleteFolder(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/folders/[id]");
  }
}
