import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  gaiaErrorResponse,
  getNote,
  trashNote,
  updateNote,
} from "@/server/gaia";

/**
 * GET    /api/gaia/notes/[id] : note complète (touche lastViewedAt).
 * PATCH  /api/gaia/notes/[id] : autosave + métadonnées.
 * DELETE /api/gaia/notes/[id] : soft delete vers la corbeille.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await getNote(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const result = await updateNote(session.user.id, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await trashNote(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]");
  }
}
