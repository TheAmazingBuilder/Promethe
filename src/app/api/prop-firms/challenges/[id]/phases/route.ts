import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propPhaseResultInputSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createPropPhaseResult } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-phase-post:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propPhaseResultInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some phase result fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const phaseResult = await createPropPhaseResult(session.user.id, id, parsed.data);
    if (!phaseResult) return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    return NextResponse.json({ phaseResult }, { status: 201 });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/phases");
  }
}
