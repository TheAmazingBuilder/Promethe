import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { calendarQuerySchema } from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import { getCalendar } from "@/server/calendar";

/**
 * GET /api/calendar?year=2025&month=5&account=… — month grid, per-day P&L,
 * summary and streaks (closed trades bucketed in the user's timezone).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`calendar:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = calendarQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid month.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const payload = await getCalendar(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "calendar");
  }
}
