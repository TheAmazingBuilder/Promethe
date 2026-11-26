import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { compareStrategyVersions } from "@/server/strategy-versions";

/**
 * GET /api/strategies/[id]/versions/compare?a=<versionId>&b=<versionId>
 * — field-by-field diff between two snapshots (Lot 11, roadmap §14).
 * `a` is the older snapshot, `b` the newer one; the server orders them
 * by creation time regardless of the query order. Identical ids → 422.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const a = url.searchParams.get("a");
    const b = url.searchParams.get("b");
    if (!a || !b || a === b) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Two different version ids are required." },
        { status: 422 },
      );
    }
    const compared = await compareStrategyVersions(session.user.id, id, a, b);
    if (!compared) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Strategy or version not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(compared);
  } catch (error) {
    return apiError(error, "strategies/[id]/versions/compare");
  }
}
