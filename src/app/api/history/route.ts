import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listChangeLogGroups } from "@/server/change-log";

/**
 * GET /api/history?limit=50 - grouped change history, latest first.
 * Each group is one undoable action (bulk edit or delete).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const limitRaw = new URL(req.url).searchParams.get("limit");
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50));
    const groups = await listChangeLogGroups(session.user.id, limit);
    return NextResponse.json({ groups });
  } catch (error) {
    return apiError(error, "history");
  }
}
