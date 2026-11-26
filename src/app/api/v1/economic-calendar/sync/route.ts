import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { getEconomicCalendarSources, runEconomicCalendarSync } from "@/server/economic-calendar";

/** POST refresh all provider sources (throttled per source, 5 min). */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`economic-calendar-sync:${session.user.id}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many refreshes. Please wait a moment." },
        { status: 429 },
      );
    }
    const body = await req.json().catch(() => null);
    const force = body != null && typeof body === "object" && (body as { force?: unknown }).force === true;
    const report = await runEconomicCalendarSync({ force });
    return NextResponse.json({ report });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}

export async function GET() {
  try {
    await requireUser();
    const sources = await getEconomicCalendarSources();
    return NextResponse.json({ sources });
  } catch (error) {
    return apiError(error, "economic-calendar");
  }
}
