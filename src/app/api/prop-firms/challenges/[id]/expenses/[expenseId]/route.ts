import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propExpensePatchSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { deletePropExpense, updatePropExpense } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

/** PATCH /api/prop-firms/challenges/[id]/expenses/[expenseId] — correct an expense. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, expenseId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-expense-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propExpensePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some expense fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const expense = await updatePropExpense(session.user.id, id, expenseId, parsed.data);
    if (!expense) return NextResponse.json({ error: "NOT_FOUND", message: "Expense not found." }, { status: 404 });
    return NextResponse.json({ expense });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/expenses/[expenseId]");
  }
}

/** DELETE /api/prop-firms/challenges/[id]/expenses/[expenseId] — remove an expense. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, expenseId } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-expense-delete:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const deleted = await deletePropExpense(session.user.id, id, expenseId);
    if (!deleted) return NextResponse.json({ error: "NOT_FOUND", message: "Expense not found." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/expenses/[expenseId]");
  }
}
