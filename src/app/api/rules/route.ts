import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { ruleInputSchema, zodFieldErrors } from "@/lib/validations/shared";
import { createRule, listRules } from "@/server/rules";

/**
 * GET  /api/rules — the user's trading rules (active first).
 * POST /api/rules — create a rule, then BULK re-evaluate history so the
 *                   new limit applies to past trades too.
 */
export async function GET() {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`rules:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const rules = await listRules(session.user.id);
    return NextResponse.json({ rules });
  } catch (error) {
    return apiError(error, "rules");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`rules-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = ruleInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Certains champs sont invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const rule = await createRule(session.user.id, parsed.data);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return apiError(error, "rules");
  }
}
