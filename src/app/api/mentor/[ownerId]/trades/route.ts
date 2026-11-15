/**
 * GET /api/mentor/[ownerId]/trades — scoped, redacted, paginated trades list.
 * Every request re-verifies the live access row: pause/expiry/revoke take
 * effect immediately (ACCESS_DENIED otherwise).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requireMentorContext } from "@/server/mentors";
import { listMentorTrades } from "@/server/mentor-views";

type Ctx = { params: Promise<{ ownerId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { ownerId } = await ctx.params;
    const mentorCtx = await requireMentorContext(session.user.id, ownerId);

    const url = new URL(req.url);
    const result = await listMentorTrades(mentorCtx, {
      page: Number(url.searchParams.get("page")) || 1,
      pageSize: Number(url.searchParams.get("pageSize")) || 20,
      status: url.searchParams.get("status") ?? undefined,
      direction: url.searchParams.get("direction") ?? undefined,
      reviewStatus: url.searchParams.get("reviewStatus") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "mentor/[ownerId]/trades");
  }
}
