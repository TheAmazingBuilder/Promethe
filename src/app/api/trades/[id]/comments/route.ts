/**
 * GET  /api/trades/[id]/comments - the owner's thread on their own trade.
 * POST /api/trades/[id]/comments - add a comment (owner only).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listComments, createComment } from "@/server/comments";
import { commentCreateSchema } from "@/lib/validations/comments";
import { zodFieldErrors } from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const payload = await listComments(session.user.id, id);
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
