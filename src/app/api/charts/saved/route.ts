import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createSavedChart, listSavedCharts } from "@/server/charts";
import { savedChartInputSchema } from "@/lib/validations/charts";
import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * GET  /api/charts/saved — the user's saved chart-builder definitions.
 * POST /api/charts/saved — save a new chart (validated config JSON).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const charts = await listSavedCharts(session.user.id);
    return NextResponse.json({ charts });
  } catch (error) {
    return apiError(error, "charts/saved");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = savedChartInputSchema.safeParse(body);
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
    const chart = await createSavedChart(session.user.id, parsed.data);
    return NextResponse.json({ chart }, { status: 201 });
  } catch (error) {
    return apiError(error, "charts/saved");
  }
}
