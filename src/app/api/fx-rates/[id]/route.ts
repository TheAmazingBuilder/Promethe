import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteFxRate, updateFxRate } from "@/server/tools";
import {
  fxRatePatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/fx-rates/[id] - edit a rate (pair change is allowed).
 * DELETE /api/fx-rates/[id]
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = fxRatePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const rate = await updateFxRate(session.user.id, id, parsed.data);
    if (!rate) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Taux introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ rate });
  } catch (error) {
    return apiError(error, "fx-rates/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteFxRate(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Taux introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "fx-rates/[id]");
  }
}
