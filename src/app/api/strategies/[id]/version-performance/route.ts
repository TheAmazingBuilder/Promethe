import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { strategyVersionPerformance } from "@/server/strategy-versions";

/**
 * GET /api/strategies/[id]/version-performance — closed trades grouped
 * by the definition version frozen at entry (Lot 11, roadmap §14), so
 * results tie to the version actually traded under. The null bucket
 * holds trades that predate versioning.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const rows = await strategyVersionPerformance(session.user.id, id);
    if (rows == null) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ versions: rows });
  } catch (error) {
    return apiError(error, "strategies/[id]/version-performance");
  }
}
