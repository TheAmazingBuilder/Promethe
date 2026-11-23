import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propFirmRuleSetInputSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createPropFirmRuleSet, listPropFirmWorkspace } from "@/server/prop-firms";

export async function GET() {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`prop-firm-rules:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const workspace = await listPropFirmWorkspace(session.user.id);
    return NextResponse.json({ ruleSets: workspace.ruleSets });
  } catch (error) {
    return apiError(error, "prop-firms/rule-sets");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`prop-firm-rules-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propFirmRuleSetInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some rule set fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const ruleSet = await createPropFirmRuleSet(session.user.id, parsed.data);
    return NextResponse.json({ ruleSet }, { status: 201 });
  } catch (error) {
    return apiError(error, "prop-firms/rule-sets");
  }
}
