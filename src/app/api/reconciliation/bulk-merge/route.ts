/**
 * POST /api/reconciliation/bulk-merge — merge all high-confidence pairs
 * (score ≥ 0.9, exactly one candidate). Every merge stays undoable.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { bulkMergeHighConfidence } from "@/server/reconciliation";

export async function POST() {
  try {
    const session = await requireUser();
    const result = await bulkMergeHighConfidence(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "reconciliation/bulk-merge");
  }
}
