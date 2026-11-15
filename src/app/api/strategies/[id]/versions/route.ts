import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { strategyVersionSchema, zodFieldErrors } from "@/lib/validations/shared";
import { createVersion, listVersions } from "@/server/strategies";

/**
 * GET  /api/strategies/[id]/versions — immutable snapshots, newest first.
 * POST /api/strategies/[id]/versions — snapshot the current definition.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`strategy-versions:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const versions = await listVersions(session.user.id, id);
    if (versions == null) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Stratégie introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ versions });
  } catch (error) {
    return apiError(error, "strategies/[id]/versions");
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    sweepRateLimits();
    if (!rateLimit(`strategy-version-post:${session.user.id}`, 20, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = strategyVersionSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Note invalide.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const version = await createVersion(
      session.user.id,
      id,
      parsed.data.note ?? null
    );
    if (version == null) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Stratégie introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return apiError(error, "strategies/[id]/versions");
  }
}
