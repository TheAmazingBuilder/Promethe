/** DELETE /api/broker-sync/magic/[id] - remove a magic mapping. */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { deleteMagicMapping } from "@/server/broker-sync";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireUser();
    const removed = await deleteMagicMapping(session.user.id, id);
    if (!removed) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Mapping not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "broker-sync/magic/[id]");
  }
}
