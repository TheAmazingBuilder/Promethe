/**
 * GET /api/mentor/[ownerId]/media/[screenshotId] — streams a screenshot to a
 * scoped mentor. Re-validates the live access row, canViewScreenshots AND the
 * trade's account/strategy scope on EVERY request: revoking the access (or
 * editing the scope) kills image access immediately. Neutral 404 otherwise.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { requireMentorContext } from "@/server/mentors";
import { readMentorMedia } from "@/server/mentor-views";

type Ctx = { params: Promise<{ ownerId: string; screenshotId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { ownerId, screenshotId } = await ctx.params;
    const mentorCtx = await requireMentorContext(session.user.id, ownerId);
    const media = await readMentorMedia(mentorCtx, screenshotId);
    if (!media) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Screenshot not found." },
        { status: 404 }
      );
    }
    return new NextResponse(new Uint8Array(media.buffer), {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "mentor/[ownerId]/media/[screenshotId]");
  }
}
