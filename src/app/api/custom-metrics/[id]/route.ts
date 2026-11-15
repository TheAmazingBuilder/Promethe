import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteCustomMetric,
  patchCustomMetric,
} from "@/server/custom-metrics";
import { customMetricPatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/custom-metrics/[id] — partial update (ownership enforced,
 * formula re-validated when the definition changes).
 * DELETE /api/custom-metrics/[id].
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = customMetricPatchSchema.safeParse(body);
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
    const metric = await patchCustomMetric(session.user.id, id, parsed.data);
    return NextResponse.json({ metric });
  } catch (error) {
    return apiError(error, "custom-metrics/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteCustomMetric(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Métrique introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "custom-metrics/[id]");
  }
}
