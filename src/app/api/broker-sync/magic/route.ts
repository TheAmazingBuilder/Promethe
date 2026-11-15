/**
 * GET  /api/broker-sync/magic — magic number → strategy mappings.
 * POST /api/broker-sync/magic — create a mapping.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { BrokerSyncError, createMagicMapping, listMagicMappings } from "@/server/broker-sync";
import { magicMappingSchema, zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const mappings = await listMagicMappings(session.user.id);
    return NextResponse.json({ mappings });
  } catch (error) {
    return apiError(error, "broker-sync/magic");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = magicMappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const mapping = await createMagicMapping(session.user.id, parsed.data);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync/magic");
  }
}
