import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { exportDashboard } from "@/server/dashboards";

/**
 * GET /api/dashboards/[id]/export — versioned import-file payload for that
 * one dashboard (no ids, no accountOverride — portable by design).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const payload = await exportDashboard(session.user.id, id);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "dashboards/[id]/export");
  }
}
