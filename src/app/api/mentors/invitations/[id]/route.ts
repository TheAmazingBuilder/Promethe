/**
 * DELETE /api/mentors/invitations/[id] — revoke a pending invitation (owner).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { revokeInvitation } from "@/server/mentors";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    await revokeInvitation(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "mentors/invitations/[id]");
  }
}
