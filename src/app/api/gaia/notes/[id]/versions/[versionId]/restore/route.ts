import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { gaiaErrorResponse, restoreVersion } from "@/server/gaia";

/** POST /api/gaia/notes/[id]/versions/[versionId]/restore : restaurer une version. */
type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, versionId } = await ctx.params;
    const result = await restoreVersion(session.user.id, id, versionId);
    return NextResponse.json(result);
  } catch (error) {
    return (
      gaiaErrorResponse(error) ??
      apiError(error, "gaia/notes/[id]/versions/[versionId]/restore")
    );
  }
}
