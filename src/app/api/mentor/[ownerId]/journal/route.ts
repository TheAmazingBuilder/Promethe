/**
 * GET /api/mentor/[ownerId]/journal — read-only journal entries (403 when
 * canViewJournal is false — the mentor knows journal is off, not hidden data).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requireMentorContext } from "@/server/mentors";
import { listMentorJournal } from "@/server/mentor-views";
import { AccessDeniedError } from "@/lib/access";

type Ctx = { params: Promise<{ ownerId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { ownerId } = await ctx.params;
    const mentorCtx = await requireMentorContext(session.user.id, ownerId);

    const url = new URL(req.url);
    const result = await listMentorJournal(
      mentorCtx,
      Number(url.searchParams.get("page")) || 1,
      Number(url.searchParams.get("pageSize")) || 20
    );
    if (!result) {
      throw new AccessDeniedError("The journal is not shared with you.");
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "mentor/[ownerId]/journal");
  }
}
