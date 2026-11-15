/**
 * GET /api/reconciliation?accountId=&status= — candidate pairs queue.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listCandidates } from "@/server/reconciliation";

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const candidates = await listCandidates(session.user.id, { accountId, status });
    return NextResponse.json({ candidates });
  } catch (error) {
    return apiError(error, "reconciliation");
  }
}
