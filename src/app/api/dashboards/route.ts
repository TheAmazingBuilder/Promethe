import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createDashboard, listDashboards } from "@/server/dashboards";
import { getRequirements } from "@/server/dashboard-data";
import { dashboardCreateSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/dashboards — all dashboards (bootstraps the default on first
 *      read) + feature requirements for the widget catalog.
 * POST /api/dashboards — create (optionally from a built-in template key).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const [dashboards, requirements] = await Promise.all([
      listDashboards(session.user.id),
      getRequirements(session.user.id),
    ]);
    return NextResponse.json({ dashboards, requirements });
  } catch (error) {
    return apiError(error, "dashboards");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = dashboardCreateSchema.safeParse(body);
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
    const dashboard = await createDashboard(session.user.id, parsed.data);
    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (error) {
    return apiError(error, "dashboards");
  }
}
