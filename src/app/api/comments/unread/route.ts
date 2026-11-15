/**
 * GET /api/comments/unread — unread comment badge for the owner (comments by
 * others on my trades newer than my last read of each trade).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { unreadCommentCount } from "@/server/comments";

export async function GET() {
  try {
    const session = await requireUser();
    const count = await unreadCommentCount(session.user.id);
    return NextResponse.json({ count });
  } catch (error) {
    return apiError(error, "comments/unread");
  }
}
