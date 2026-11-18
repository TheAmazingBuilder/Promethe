/**
 * GET  /api/trades/[id]/comments — the thread (owner or scoped mentor),
 *        mentionable users, canComment flag, viewer's last-read marker.
 *        Marks the thread as READ for the viewer as a side effect.
 * POST /api/trades/[id]/comments — add a comment (owner, or mentor with
 *        canComment). Mentions validated server-side against CURRENT access.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listComments, createComment, markTradeRead } from "@/server/comments";
import { commentCreateSchema } from "@/lib/validations/mentor";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const payload = await listComments(session.user.id, id);
    // Viewing the thread marks it read (badge clearing).
    await markTradeRead(session.user.id, id).catch(() => undefined);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "trades/[id]/comments");
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = commentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid comment.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const comment = await createComment(session.user.id, id, parsed.data);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return apiError(error, "trades/[id]/comments");
  }
}
