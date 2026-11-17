import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createExitPlan, listExitPlans } from "@/server/tools";
import {
  exitPlanInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET  /api/exit-plans - partial exit plans (tiers sum to 100%).
 * POST /api/exit-plans - create.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const plans = await listExitPlans(session.user.id);
    return NextResponse.json({ plans });
  } catch (error) {
    return apiError(error, "exit-plans");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = exitPlanInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const plan = await createExitPlan(session.user.id, parsed.data);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return apiError(error, "exit-plans");
  }
}
