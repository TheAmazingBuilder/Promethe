import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteTrade, getTradeDetail, updateTrade } from "@/server/trades";
import { tradePatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET    /api/trades/[id] — detail (ownership enforced by scoping).
 * PATCH  /api/trades/[id] — partial update, derived values recomputed
 *          server-side; last-write-wins with a conflict report (v2 §4.2).
 * DELETE /api/trades/[id]
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const trade = await getTradeDetail(session.user.id, id);
    if (!trade) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ trade });
  } catch (error) {
    return apiError(error, "trades/[id]");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = tradePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await updateTrade(session.user.id, id, parsed.data);
    if (!result) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "trades/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteTrade(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "trades/[id]");
  }
}
