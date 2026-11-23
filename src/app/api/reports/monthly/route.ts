import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getMonthlyReport, monthRange } from "@/server/reports";

/**
 * GET /api/reports/monthly?month=YYYY-MM - the month's closed trades,
 * aggregated for the PDF export. Scoped by session user.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const accountId = url.searchParams.get("account");
    if (monthRange(month) == null) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid month (YYYY-MM format)." },
        { status: 422 }
      );
    }
    const report = await getMonthlyReport(session.user.id, month, accountId);
    if (!report) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid month." },
        { status: 422 }
      );
    }
    return NextResponse.json(report);
  } catch (error) {
    return apiError(error, "reports/monthly");
  }
}
