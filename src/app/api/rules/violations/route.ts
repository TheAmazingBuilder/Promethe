import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { violationsQuerySchema, zodFieldErrors } from "@/lib/validations/shared";
import { recentViolations } from "@/server/rules";

/**
 * GET /api/rules/violations?days=30 — recent rule violations (widget +
 * objectives view), newest first, capped at 100.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`rules-violations:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop de requêtes, patientez." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = violationsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Paramètre days invalide.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const violations = await recentViolations(session.user.id, parsed.data.days);
    return NextResponse.json({ violations, days: parsed.data.days });
  } catch (error) {
    return apiError(error, "rules/violations");
  }
}
