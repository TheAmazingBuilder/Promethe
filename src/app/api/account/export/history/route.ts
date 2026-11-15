/**
 * GET /api/account/export/history — DataExportLog rows (settings view).
 * 200 { history } · 401
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listExportHistory } from "@/server/account-export";

export async function GET() {
  try {
    const session = await requireUser();
    const history = await listExportHistory(session.user.id);
    return NextResponse.json({
      history: history.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        kind: row.kind,
        sizeBytes: row.sizeBytes,
        schemaVersion: row.schemaVersion,
      })),
    });
  } catch (error) {
    return apiError(error, "account/export/history");
  }
}
