import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteDashboard, patchDashboard } from "@/server/dashboards";
import { dashboardPatchSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * PATCH  /api/dashboards/[id] — rename / re-icon / set default.
 * DELETE /api/dashboards/[id] — remove (never the last one; the default
 *        flag is promoted to the first remaining dashboard).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = dashboardPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Some fields are invalid.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const dashboard = await patchDashboard(session.user.id, id, parsed.data);
    return NextResponse.json({ dashboard });
  } catch (error) {
    return apiError(error, "dashboards/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    await deleteDashboard(session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "dashboards/[id]");
  }
}
