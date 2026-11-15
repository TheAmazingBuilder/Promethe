import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteWidget, patchWidget } from "@/server/dashboards";
import { widgetPatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/dashboards/[id]/widgets/[widgetId] — title / config / layouts /
 *        periodOverride / accountOverride (ownership of BOTH the dashboard
 *        and the widget is enforced).
 * DELETE /api/dashboards/[id]/widgets/[widgetId].
 */
type Ctx = { params: Promise<{ id: string; widgetId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, widgetId } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = widgetPatchSchema.safeParse(body);
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
    const widget = await patchWidget(
      session.user.id,
      id,
      widgetId,
      parsed.data
    );
    return NextResponse.json({ widget });
  } catch (error) {
    return apiError(error, "dashboards/[id]/widgets/[widgetId]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id, widgetId } = await ctx.params;
    await deleteWidget(session.user.id, id, widgetId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "dashboards/[id]/widgets/[widgetId]");
  }
}
