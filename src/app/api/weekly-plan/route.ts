import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  getWeeklyPlan,
  toggleWeeklyPlanAction,
} from "@/server/weekly-plan";
import {
  weeklyPlanQuerySchema,
  weeklyPlanToggleSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET /api/weekly-plan — the weekly improvement plan for the current
 * Monday-Sunday week, built by rules from the last 30 days of closed
 * trades. Query: account (optional id). Scoped by session user.
 * POST /api/weekly-plan — toggle one "Done this week" checkbox
 * ({ rule, done }); the rule must belong to the current week's plan.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = weeklyPlanQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid filters.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    sweepRateLimits();
    if (!rateLimit(`weekly-plan:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const payload = await getWeeklyPlan(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "weekly-plan");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const queryParsed = weeklyPlanQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );
    const body = await req.json().catch(() => null);
    const parsed = weeklyPlanToggleSchema.safeParse(body);
    if (!queryParsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(queryParsed.error),
        },
        { status: 422 }
      );
    }
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
    sweepRateLimits();
    if (!rateLimit(`weekly-plan-toggle:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const action = await toggleWeeklyPlanAction(
      session.user.id,
      parsed.data,
      queryParsed.data
    );
    if (action == null) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "This action is not in this week's plan." },
        { status: 404 }
      );
    }
    return NextResponse.json({ action });
  } catch (error) {
    return apiError(error, "weekly-plan");
  }
}
