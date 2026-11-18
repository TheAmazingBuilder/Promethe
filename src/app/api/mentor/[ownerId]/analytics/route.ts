/**
 * GET /api/mentor/[ownerId]/analytics — KPIs, equity curve (percent-normalized
 * when amounts are hidden), per-strategy stats — computed on SCOPED trades
 * only. 403 when canViewAnalytics is false.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requireMentorContext } from "@/server/mentors";
import { getMentorAnalytics } from "@/server/mentor-views";
import { AccessDeniedError } from "@/lib/access";

type Ctx = { params: Promise<{ ownerId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { ownerId } = await ctx.params;
    const mentorCtx = await requireMentorContext(session.user.id, ownerId);
    const result = await getMentorAnalytics(mentorCtx);
    if (!result) {
      throw new AccessDeniedError("Analytics are not shared with you.");
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "mentor/[ownerId]/analytics");
  }
}
