import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteStrategy, updateStrategy } from "@/server/reference";
import { strategyInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/strategies/[id] · DELETE /api/strategies/[id] (trades keep
 * history — strategyId is SetNull).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = strategyInputSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const strategy = await updateStrategy(session.user.id, id, parsed.data);
    if (!strategy) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Stratégie introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ strategy });
  } catch (error) {
    return apiError(error, "strategies/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteStrategy(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Stratégie introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "strategies/[id]");
  }
}
