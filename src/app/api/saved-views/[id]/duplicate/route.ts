import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { duplicateSavedView } from "@/server/reference";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/saved-views/[id]/duplicate - copy as "name (copie)". */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const view = await duplicateSavedView(session.user.id, id);
    if (!view) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Vue introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    return apiError(error, "saved-views/[id]/duplicate");
  }
}
