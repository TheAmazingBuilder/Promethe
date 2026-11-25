import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { restorePropPayout } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string; payoutId: string }> };

/** POST /api/prop-firms/challenges/[id]/payouts/[payoutId]/restore - §13 restore a logically deleted payout. */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, payoutId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-payout-restore:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const payout = await restorePropPayout(session.user.id, id, payoutId);
    if (!payout) return NextResponse.json({ error: "NOT_FOUND", message: "Payout not found." }, { status: 404 });
    return NextResponse.json({ payout });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/payouts/[payoutId]/restore");
  }
}
