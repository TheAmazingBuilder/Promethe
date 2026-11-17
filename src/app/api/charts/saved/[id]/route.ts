import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteSavedChart, getSavedChart, updateSavedChart } from "@/server/charts";
import { savedChartPatchSchema } from "@/lib/validations/charts";
import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * GET    /api/charts/saved/[id] — one saved chart (ownership-scoped).
 * PATCH  /api/charts/saved/[id] — rename and/or replace the config.
 * DELETE /api/charts/saved/[id] — remove (404 when not owned).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const chart = await getSavedChart(session.user.id, id);
    if (!chart) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Chart not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ chart });
  } catch (error) {
    return apiError(error, "charts/saved/[id]");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = savedChartPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid chart configuration.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const chart = await updateSavedChart(session.user.id, id, parsed.data);
    if (!chart) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Chart not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ chart });
  } catch (error) {
    return apiError(error, "charts/saved/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const deleted = await deleteSavedChart(session.user.id, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Chart not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "charts/saved/[id]");
  }
}
