/**
 * PATCH  /api/trades/[id]/comments/[commentId] — edit own comment (author
 *         only, shows "edited"); mentions re-validated.
 * DELETE /api/trades/[id]/comments/[commentId] — author or journal owner;
 *         tombstone when the comment has replies, hard delete otherwise.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteComment, editComment } from "@/server/comments";
import { commentEditSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string; commentId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id: _tradeId, commentId } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = commentEditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Commentaire invalide.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const comment = await editComment(session.user.id, commentId, parsed.data);
    return NextResponse.json({ comment });
  } catch (error) {
    return apiError(error, "trades/[id]/comments/[commentId]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id: _tradeId, commentId } = await ctx.params;
    await deleteComment(session.user.id, commentId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "trades/[id]/comments/[commentId]");
  }
}
