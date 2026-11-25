import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { getPropChallengeEvaluation } from "@/server/prop-evaluation";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/prop-firms/challenges/[id]/evaluation — Lot 5 engine result for
 * one challenge of the signed-in user. The evaluation is computed on
 * demand from the challenge's frozen rules and its own trades, so it is
 * always in sync with the data. 404 when the challenge is not owned.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-evaluation:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const evaluation = await getPropChallengeEvaluation(session.user.id, id);
    if (!evaluation) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    }
    return NextResponse.json({ evaluation });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/evaluation");
  }
}
