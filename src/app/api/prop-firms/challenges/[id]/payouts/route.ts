import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propPayoutInputSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createPropPayout } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-payout-post:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propPayoutInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some payout fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const payout = await createPropPayout(session.user.id, id, parsed.data);
    if (!payout) return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    return NextResponse.json({ payout }, { status: 201 });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/payouts");
  }
}
