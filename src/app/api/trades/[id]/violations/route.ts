import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { tradeViolations } from "@/server/rules";

/**
 * GET /api/trades/[id]/violations — rule violations attached to one trade
 * (trade detail view). Empty array when none — never 404s on the rule side.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`trade-violations:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const violations = await tradeViolations(session.user.id, id);
    return NextResponse.json({ violations });
  } catch (error) {
    return apiError(error, "trades/[id]/violations");
  }
}
