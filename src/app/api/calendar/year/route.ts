import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getYearDays } from "@/server/calendar";

/**
 * GET /api/calendar/year?year=2025&account=<id> — daily aggregates for the
 * yearly contribution calendar (v2.5 M2 Phase 5).
 */
const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  account: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid parameters." },
        { status: 422 }
      );
    }
    const payload = await getYearDays(
      session.user.id,
      parsed.data.year,
      parsed.data.account
    );
    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, "calendar/year");
  }
}
