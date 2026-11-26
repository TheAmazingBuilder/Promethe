import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { listPropFinanceAudit } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/prop-firms/challenges/[id]/finance-audit - §13 audit trail of
 * the challenge's payouts and expenses, newest first. 404 when the
 * challenge is not owned.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-finance-audit:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const audit = await listPropFinanceAudit(session.user.id, id);
    if (!audit) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    }
    return NextResponse.json({ audit });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/finance-audit");
  }
}
