/**
 * GET /api/mentor/[ownerId]/trades/[tradeId] — scoped read-only trade detail
 * (journal/psychology/screenshots gated by permissions, amounts redacted to
 * pips & R when canViewAmounts is false). 404 outside the scope.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requireMentorContext } from "@/server/mentors";
import { getMentorTradeDetail } from "@/server/mentor-views";

type Ctx = { params: Promise<{ ownerId: string; tradeId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { ownerId, tradeId } = await ctx.params;
    const mentorCtx = await requireMentorContext(session.user.id, ownerId);
    const result = await getMentorTradeDetail(mentorCtx, tradeId);
    if (!result) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade introuvable dans ce périmètre." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "mentor/[ownerId]/trades/[tradeId]");
  }
}
