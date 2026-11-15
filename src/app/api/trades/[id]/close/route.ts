import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { closeTrade } from "@/server/trades";
import { closeTradeSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/trades/[id]/close — quick "close open trade" action (v2 §4.1).
 * exitTime defaults to now; derived values recomputed server-side.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = closeTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const trade = await closeTrade(session.user.id, id, parsed.data);
    if (!trade) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Trade introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ trade });
  } catch (error) {
    return apiError(error, "trades/[id]/close");
  }
}
