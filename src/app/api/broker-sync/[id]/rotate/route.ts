/**
 * POST /api/broker-sync/[id]/rotate — issue a fresh token (old one dies).
 * The new raw token is returned ONCE.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { BrokerSyncError, rotateToken } from "@/server/broker-sync";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const rotated = await rotateToken(session.user.id, id);
    return NextResponse.json(rotated);
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync/rotate");
  }
}
