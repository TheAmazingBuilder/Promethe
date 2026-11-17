import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { reorderDashboards } from "@/server/dashboards";
import { dashboardsReorderSchema, zodFieldErrors } from "@/lib/validations/shared";

/** POST /api/dashboards/reorder - full order array (all dashboard ids). */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = dashboardsReorderSchema.safeParse(body);
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
    const dashboards = await reorderDashboards(
      session.user.id,
      parsed.data.order
    );
    return NextResponse.json({ dashboards });
  } catch (error) {
    return apiError(error, "dashboards/reorder");
  }
}
