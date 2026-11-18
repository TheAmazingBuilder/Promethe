import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { duplicateNote, gaiaErrorResponse } from "@/server/gaia";

/** POST /api/gaia/notes/[id]/duplicate : dupliquer une note (201). */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const result = await duplicateNote(session.user.id, id, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]/duplicate");
  }
}
