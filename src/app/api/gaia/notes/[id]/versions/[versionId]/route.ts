import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, getVersion } from "@/server/gaia";

/** GET /api/gaia/notes/[id]/versions/[versionId] : une version (blocs complets). */
type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, versionId } = await ctx.params;
    const result = await getVersion(session.user.id, id, versionId);
    return NextResponse.json(result);
  } catch (error) {
    return (
      gaiaErrorResponse(error) ?? apiError(error, "gaia/notes/[id]/versions/[versionId]")
    );
  }
}
