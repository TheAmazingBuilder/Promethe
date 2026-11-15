import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { applyTemplate } from "@/server/dashboards";
import { templateApplySchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/dashboards/[id]/apply-template — replace mode: drop the current
 * widgets and insert the built-in template's. Body: { templateKey }.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = templateApplySchema.safeParse(body);
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
    const { dashboard, skipped } = await applyTemplate(
      session.user.id,
      id,
      parsed.data.templateKey
    );
    return NextResponse.json({ dashboard, skipped });
  } catch (error) {
    return apiError(error, "dashboards/[id]/apply-template");
  }
}
