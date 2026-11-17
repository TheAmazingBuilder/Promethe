import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, listVersions } from "@/server/gaia";

/** GET /api/gaia/notes/[id]/versions : historique des versions (plus récent d'abord). */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const result = await listVersions(session.user.id, id);
    return NextResponse.json(result);
  } catch (error) {
    return gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]/versions");
  }
}
