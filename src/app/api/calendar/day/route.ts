import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import { calendarDayQuerySchema } from "@/lib/validations/journal";
import { zodFieldErrors } from "@/lib/validations/shared";
import { getCalendarDay } from "@/server/calendar";

/**
 * GET /api/calendar/day?date=YYYY-MM-DD&account=… — one trading day:
 * its closed trades (bucketed by trading day of exit, same as the month
 * grid) with day totals, for the calendar day-detail panel (MRT wave 2).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`calendar-day:${session.user.id}`, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests, please wait." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = calendarDayQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid day.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const payload = await getCalendarDay(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "calendar-day");
  }
}
