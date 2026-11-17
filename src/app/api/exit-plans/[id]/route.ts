import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteExitPlan, updateExitPlan } from "@/server/tools";
import {
  exitPlanPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/exit-plans/[id] - edit a plan.
 * DELETE /api/exit-plans/[id] - trades linked to it keep exitPlanId null
 *          (FK is SetNull in the schema).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = exitPlanPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const plan = await updateExitPlan(session.user.id, id, parsed.data);
    if (!plan) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Plan introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ plan });
  } catch (error) {
    return apiError(error, "exit-plans/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteExitPlan(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Plan introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "exit-plans/[id]");
  }
}
