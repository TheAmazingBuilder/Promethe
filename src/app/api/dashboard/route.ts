import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getDashboard } from "@/server/dashboard";

/**
 * GET /api/dashboard — KPIs (30 d + all time), open positions, review count,
 * equity curve, strategy stats, recent trades. Scoped by session user.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const payload = await getDashboard(session.user.id);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "dashboard");
  }
}
