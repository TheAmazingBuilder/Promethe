/**
 * PATCH  /api/broker-sync/[id] — label / autoMerge / backfill window / reset binding.
 * DELETE /api/broker-sync/[id] — revoke immediately (token dies with it).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { BrokerSyncError, revokeConnection, updateConnection } from "@/server/broker-sync";
import { brokerConnectionUpdateSchema, zodFieldErrors } from "@/lib/validations/shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = brokerConnectionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const connection = await updateConnection(session.user.id, id, parsed.data);
    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync/[id]");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const connection = await revokeConnection(session.user.id, id);
    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync/[id]");
  }
}
