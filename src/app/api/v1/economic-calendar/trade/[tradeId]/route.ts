import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getTradeEventContext } from "@/server/economic-calendar";

/** GET the market context of one trade: snapshot + linked events. */
export async function GET(_req: Request, { params }: { params: Promise<{ tradeId: string }> }) {
  try {
    const session = await requireUser();
    const { tradeId } = await params;
    const context = await getTradeEventContext(session.user.id, tradeId);
    if (!context) {
      return NextResponse.json({ error: "TRADE_NOT_FOUND", message: "Trade not found." }, { status: 404 });
    }
    return NextResponse.json({ context });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}
