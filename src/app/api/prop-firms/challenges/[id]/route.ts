import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propChallengePatchSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { deletePropChallenge, updatePropChallenge } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-challenge-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propChallengePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some challenge fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const challenge = await updatePropChallenge(session.user.id, id, parsed.data);
    if (!challenge) return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    return NextResponse.json({ challenge });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-challenge-delete:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const deleted = await deletePropChallenge(session.user.id, id);
    if (!deleted) return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]");
  }
}
