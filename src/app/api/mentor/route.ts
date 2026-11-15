/**
 * GET /api/mentor — mentor space home: mentees (with new trades / unreviewed /
 * unread comments badges) + received invitations + whether the viewer is a
 * mentor at all (drives nav visibility).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listMentees, listReceivedInvitations } from "@/server/mentors";

export async function GET() {
  try {
    const session = await requireUser();
    const [mentees, invitations] = await Promise.all([
      listMentees(session.user.id),
      listReceivedInvitations(session.user),
    ]);
    return NextResponse.json({
      mentees,
      invitations,
      isMentor: mentees.length > 0 || invitations.some((i) => i.status === "PENDING"),
    });
  } catch (error) {
    return apiError(error, "mentor");
  }
}
