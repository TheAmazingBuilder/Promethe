import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteVersion } from "@/server/strategies";

/** DELETE /api/strategies/[id]/versions/[versionId] — remove a snapshot. */
type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, versionId } = await ctx.params;
    const ok = await deleteVersion(session.user.id, id, versionId);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Version introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "strategies/[id]/versions/[versionId]");
  }
}
