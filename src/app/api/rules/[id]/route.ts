import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { rulePatchSchema, zodFieldErrors } from "@/lib/validations/shared";
import { deleteRule, updateRule } from "@/server/rules";

/**
 * PATCH  /api/rules/[id] — edit; value/kind/isActive changes trigger a
 *                          bulk re-evaluation of the violation history.
 * DELETE /api/rules/[id] — violations cascade-delete with the rule.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`rules-patch:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = rulePatchSchema.safeParse(body);
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
    const rule = await updateRule(session.user.id, id, parsed.data);
    if (!rule) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Règle introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ rule });
  } catch (error) {
    return apiError(error, "rules/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`rules-delete:${session.user.id}`, 30, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const ok = await deleteRule(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Règle introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "rules/[id]");
  }
}
