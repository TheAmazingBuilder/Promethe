import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { strategyStatsExtended } from "@/server/playbook";

/**
 * GET /api/strategies/stats — per-strategy stats with cumulative-R sparkline,
 * expectancy over the last 20 closed trades and the underperformance flag.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const stats = await strategyStatsExtended(session.user.id);
    return NextResponse.json({ stats });
  } catch (error) {
    return apiError(error, "strategies/stats");
  }
}
