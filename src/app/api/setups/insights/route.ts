import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { setupInsights } from "@/server/playbook";

/**
 * GET /api/setups/insights — 90-day insights per setup (optional
 * ?strategyId=). Small samples (n < 5) are flagged, never hidden.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const strategyId = url.searchParams.get("strategyId");
    const insights = await setupInsights(session.user.id, strategyId);
    return NextResponse.json({ insights });
  } catch (error) {
    return apiError(error, "setups/insights");
  }
}
