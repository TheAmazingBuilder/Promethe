/**
 * DELETE /api/share-links/[id] — revoke immediately (idempotent).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { revokeShareLink } from "@/server/sharing";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await revokeShareLink(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Share link not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiError(error, "share-links/[id]");
  }
}
