import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getAnalytics } from "@/server/analytics";
import { analyticsQuerySchema, zodFieldErrors } from "@/lib/validations/shared";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET /api/analytics — KPIs, equity curve, R distribution, breakdowns and
 * insights over closed trades. Query: period (30d|90d|ytd|all, default 30d),
 * account (optional account id). Scoped by session user.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = analyticsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Filtres invalides.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    sweepRateLimits();
    if (!rateLimit(`analytics:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const payload = await getAnalytics(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "analytics");
  }
}
