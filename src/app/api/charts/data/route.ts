import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getBuilderTrades } from "@/server/charts";
import { builderDataQuerySchema } from "@/lib/validations/charts";

/**
 * GET /api/charts/data?period=30d|90d|ytd|all&account=<id>
 * Chart-builder payload: filtered CLOSED trades (capped, TZ-aware local parts,
 * MFE/MAE in R) — the pure builder runs client-side for instant previews.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = builderDataQuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Paramètres invalides." },
        { status: 422 }
      );
    }
    const payload = await getBuilderTrades(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "charts/data");
  }
}
