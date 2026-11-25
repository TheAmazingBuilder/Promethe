import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propPayoutPatchSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { deletePropPayout, updatePropPayout } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string; payoutId: string }> };

/** PATCH /api/prop-firms/challenges/[id]/payouts/[payoutId] — correct a payout. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, payoutId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-payout-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propPayoutPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some payout fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const payout = await updatePropPayout(session.user.id, id, payoutId, parsed.data);
    if (!payout) return NextResponse.json({ error: "NOT_FOUND", message: "Payout not found." }, { status: 404 });
    return NextResponse.json({ payout });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/payouts/[payoutId]");
  }
}

/** DELETE /api/prop-firms/challenges/[id]/payouts/[payoutId] — remove a payout. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, payoutId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-payout-delete:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const deleted = await deletePropPayout(session.user.id, id, payoutId);
    if (!deleted) return NextResponse.json({ error: "NOT_FOUND", message: "Payout not found." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/payouts/[payoutId]");
  }
}
