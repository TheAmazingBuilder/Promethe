/**
 * GET  /api/broker-sync — list connections (status evaluated at read time).
 * POST /api/broker-sync — create; the raw token is returned ONCE.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { BrokerSyncError, createConnection, listConnections } from "@/server/broker-sync";
import { brokerConnectionCreateSchema, zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const connections = await listConnections(session.user.id);
    return NextResponse.json({ connections });
  } catch (error) {
    return apiError(error, "broker-sync");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = brokerConnectionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const created = await createConnection(session.user.id, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync");
  }
}
