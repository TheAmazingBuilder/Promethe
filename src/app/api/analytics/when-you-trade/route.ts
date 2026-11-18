import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getWhenYouTrade } from "@/server/when-you-trade";
import { analyticsQuerySchema, zodFieldErrors } from "@/lib/validations/shared";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET /api/analytics/when-you-trade — P&L and trade count by entry hour,
 * by weekday and per session x weekday cell, over closed trades.
 * Query: period (30d|90d|ytd|all, default 30d), account (optional
 * account id). Scoped by session user. Hours and weekdays are the local
 * ENTRY time in the user's timezone; only sessions present in the data
 * are returned.
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
          message: "Invalid filters.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    sweepRateLimits();
    if (!rateLimit(`analytics-when-you-trade:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const payload = await getWhenYouTrade(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "analytics-when-you-trade");
  }
}
