import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { restorePropExpense } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

/** POST /api/prop-firms/challenges/[id]/expenses/[expenseId]/restore - §13 restore a logically deleted expense. */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, expenseId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-expense-restore:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const expense = await restorePropExpense(session.user.id, id, expenseId);
    if (!expense) return NextResponse.json({ error: "NOT_FOUND", message: "Expense not found." }, { status: 404 });
    return NextResponse.json({ expense });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/expenses/[expenseId]/restore");
  }
}
