import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { goalInputSchema, zodFieldErrors } from "@/lib/validations/shared";
import { createGoal, listGoalsWithProgress } from "@/server/goals";

/**
 * GET  /api/goals — goals with computed live progress (dashboard + view).
 * POST /api/goals — create a goal.
 */
export async function GET() {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`goals:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const payload = await listGoalsWithProgress(session.user.id);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "goals");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`goals-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = goalInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const goal = await createGoal(session.user.id, parsed.data);
    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    return apiError(error, "goals");
  }
}
