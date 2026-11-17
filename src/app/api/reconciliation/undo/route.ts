/**
 * GET  /api/reconciliation/undo — undoable merge logs (≤ 30 days).
 * POST /api/reconciliation/undo — undo a merge (restores everything).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { ReconciliationError, listMergeLogs, undoMerge } from "@/server/reconciliation";

export async function GET() {
  try {
    const session = await requireUser();
    const logs = await listMergeLogs(session.user.id);
    return NextResponse.json({ logs });
  } catch (error) {
    return apiError(error, "reconciliation/undo");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = (await req.json().catch(() => null)) as { mergeLogId?: string } | null;
    if (!body?.mergeLogId) {
      return NextResponse.json({ error: "VALIDATION", message: "mergeLogId required." }, { status: 422 });
    }
    const result = await undoMerge(session.user.id, body.mergeLogId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReconciliationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "reconciliation/undo");
  }
}
