import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  getRiskRewardSummary,
  setDailyRiskBudgetPercent,
} from "@/server/risk-reward";
import { zodFieldErrors } from "@/lib/validations/shared";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET   /api/risk-reward/summary — real win rate / R:R stats + today's
 *       risk-budget gauge. Scoped by session user.
 * PATCH /api/risk-reward/summary — set or clear the daily risk budget
 *       ({ dailyRiskBudgetPercent: "2" | null }, % of balance).
 */
export async function GET() {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`risk-reward:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const summary = await getRiskRewardSummary(session.user.id);
    return NextResponse.json(summary);
  } catch (error) {
    return apiError(error, "risk-reward");
  }
}

const budgetPatchSchema = z.object({
  dailyRiskBudgetPercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "invalidDecimal")
    .refine((v) => Number(v) > 0 && Number(v) <= 100, "mustBePositive")
    .nullable(),
});

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = budgetPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid budget value.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const percent = await setDailyRiskBudgetPercent(
      session.user.id,
      parsed.data.dailyRiskBudgetPercent
    );
    return NextResponse.json({ dailyRiskBudgetPercent: percent });
  } catch (error) {
    return apiError(error, "risk-reward");
  }
}
