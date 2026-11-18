import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { undoChangeLogGroup } from "@/server/change-log";

type Ctx = { params: Promise<{ groupId: string }> };

/**
 * POST /api/history/[groupId]/undo - restore the group's BEFORE snapshots
 * in one transaction and mark the group undone. 410 when expired or
 * already undone.
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { groupId } = await ctx.params;
    const result = await undoChangeLogGroup(session.user.id, groupId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_UNDOABLE") {
      return NextResponse.json(
        { error: "NOT_UNDOABLE", message: "This action can no longer be undone." },
        { status: 410 }
      );
    }
    return apiError(error, "history/undo");
  }
}
