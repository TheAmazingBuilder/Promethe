import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createStrategy, listStrategies } from "@/server/reference";
import { strategyStats } from "@/server/strategies";
import { strategyInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/strategies — with checklist items (form selectors + templates).
 *      ?withStats=1 — also returns per-strategy stats (phase 5 view).
 * POST /api/strategies — create.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const withStats = url.searchParams.get("withStats") === "1";
    const strategies = await listStrategies(session.user.id);
    if (!withStats) {
      return NextResponse.json({ strategies });
    }
    const stats = await strategyStats(session.user.id);
    return NextResponse.json({ strategies, stats });
  } catch (error) {
    return apiError(error, "strategies");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = strategyInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const strategy = await createStrategy(session.user.id, parsed.data);
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    return apiError(error, "strategies");
  }
}
