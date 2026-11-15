import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { goalPatchSchema, zodFieldErrors } from "@/lib/validations/shared";
import { deleteGoal, updateGoal } from "@/server/goals";

/**
 * PATCH  /api/goals/[id] · DELETE /api/goals/[id]
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`goals-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = goalPatchSchema.safeParse(body);
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
    const goal = await updateGoal(session.user.id, id, parsed.data);
    if (!goal) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Objectif introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ goal });
  } catch (error) {
    return apiError(error, "goals/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`goals-delete:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const ok = await deleteGoal(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Objectif introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "goals/[id]");
  }
}
