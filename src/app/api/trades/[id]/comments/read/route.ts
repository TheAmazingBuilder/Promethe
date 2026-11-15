/**
 * POST /api/trades/[id]/comments/read — explicit read marker (used when the
 * thread is embedded but the viewer is only skimming; the GET also marks).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { markTradeRead } from "@/server/comments";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    await markTradeRead(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "trades/[id]/comments/read");
  }
}
