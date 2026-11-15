/**
 * GET /api/broker-sync/overview — dashboard widgets: connection statuses,
 * "N synced trades to complete", latest equity per account.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getSyncOverview } from "@/server/broker-sync";
import { sweepStaleConnections } from "@/lib/sync/process";

export async function GET() {
  try {
    const session = await requireUser();
    // Evaluate STALE on app open (v3 §4.1) before reading the statuses.
    await sweepStaleConnections();
    const overview = await getSyncOverview(session.user.id);
    return NextResponse.json(overview);
  } catch (error) {
    return apiError(error, "broker-sync/overview");
  }
}
