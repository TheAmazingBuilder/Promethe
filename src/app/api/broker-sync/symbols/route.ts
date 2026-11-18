/**
 * GET  /api/broker-sync/symbols — broker symbol → instrument mappings.
 * POST /api/broker-sync/symbols — upsert a mapping (with optional pipSize fix).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { BrokerSyncError, listSymbolMappings, upsertSymbolMapping } from "@/server/broker-sync";
import { symbolMappingUpsertSchema, zodFieldErrors } from "@/lib/validations/shared";

export async function GET() {
  try {
    const session = await requireUser();
    const mappings = await listSymbolMappings(session.user.id);
    return NextResponse.json({ mappings });
  } catch (error) {
    return apiError(error, "broker-sync/symbols");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = symbolMappingUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    await upsertSymbolMapping(session.user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BrokerSyncError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return apiError(error, "broker-sync/symbols");
  }
}
