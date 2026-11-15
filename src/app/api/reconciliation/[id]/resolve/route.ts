/**
 * POST /api/reconciliation/[id]/resolve — merge | reject | keep-separate.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  ReconciliationError,
  mergeCandidate,
  resolveCandidate,
} from "@/server/reconciliation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const body = (await req.json().catch(() => null)) as { action?: string } | null;
    const action = body?.action;

    if (action === "MERGE") {
      const result = await mergeCandidate(session.user.id, id);
      return NextResponse.json(result);
    }
    if (action === "REJECT" || action === "KEEP_SEPARATE") {
      await resolveCandidate(session.user.id, id, action);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "VALIDATION", message: "Action inconnue." }, { status: 422 });
  } catch (error) {
    if (error instanceof ReconciliationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "reconciliation/resolve");
  }
}
