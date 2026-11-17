import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteVersion } from "@/server/strategies";

/** DELETE /api/strategies/[id]/versions/[versionId] - remove a snapshot. */
type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, versionId } = await ctx.params;
    const { deleted, protected: isProtected } = await deleteVersion(
      session.user.id,
      id,
      versionId,
    );
    if (isProtected) {
      return NextResponse.json(
        {
          error: "PROTECTED",
          message:
            "Automatic snapshots are the audit trail of what trades were executed under and cannot be deleted.",
        },
        { status: 409 },
      );
    }
    if (!deleted) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Version not found." },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "strategies/[id]/versions/[versionId]");
  }
}
