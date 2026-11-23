import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { propExpenseInputSchema } from "@/lib/validations/prop-firms";
import { zodFieldErrors } from "@/lib/validations/shared";
import { createPropExpense } from "@/server/prop-firms";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`prop-expense-post:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json({ error: "RATE_LIMITED", message: "Too many requests, please wait." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = propExpenseInputSchema.safeParse({ ...(body && typeof body === "object" ? body : {}), challengeId: id });
    if (!parsed.success) {
      return NextResponse.json({
        error: "VALIDATION",
        message: "Some expense fields are invalid.",
        fieldErrors: zodFieldErrors(parsed.error),
      }, { status: 422 });
    }
    const expense = await createPropExpense(session.user.id, parsed.data);
    if (!expense) return NextResponse.json({ error: "NOT_FOUND", message: "Challenge not found." }, { status: 404 });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return apiError(error, "prop-firms/challenges/[id]/expenses");
  }
}
