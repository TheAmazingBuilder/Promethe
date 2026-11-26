import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propFirmRuleSetPatchSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { deletePropFirmRuleSet, updatePropFirmRuleSet } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-firm-rule-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propFirmRuleSetPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some rule set fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const ruleSet = await updatePropFirmRuleSet(session.user.id, id, parsed.data);
    if (!ruleSet) return NextResponse.json({ error: "NOT_FOUND", message: "Rule set not found." }, { status: 404 });
    return NextResponse.json({ ruleSet });
  } catch (error) {
    return apiError(error, "prop-firms/rule-sets/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-firm-rule-delete:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const deleted = await deletePropFirmRuleSet(session.user.id, id);
    if (!deleted) return NextResponse.json({ error: "NOT_FOUND", message: "Rule set not found." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "prop-firms/rule-sets/[id]");
  }
}
