import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propChallengeInputSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createPropChallenge, listPropFirmWorkspace } from "@/server/prop-firms";

export async function GET() {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`prop-firms:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    return NextResponse.json(await listPropFirmWorkspace(session.user.id));
  } catch (error) {
    return apiError(error, "prop-firms");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`prop-firms-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propChallengeInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some challenge fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const challenge = await createPropChallenge(session.user.id, parsed.data);
    if (!challenge) {
      return NextResponse.json({
        error: "NOT_FOUND",
        message: "Choose one of your PROP accounts and an accessible rule set.",
      }, { status: 404 });
    }
    return NextResponse.json({ challenge }, { status: 201 });
  } catch (error) {
    return apiError(error, "prop-firms");
  }
}
