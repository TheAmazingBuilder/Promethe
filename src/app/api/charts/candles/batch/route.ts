import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getCandleBatch } from "@/server/charts";
import { candleBatchRequestSchema } from "@/lib/validations/charts";

/**
 * POST /api/charts/candles/batch — candle windows for many trades in
 * one call (trades grid mini charts). Body: { requests:
 * [{ instrumentId, timeframe, from, to }, ...] } (1-50). Response:
 * { results: [{ candles }] } aligned by index with the request array.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = candleBatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid parameters." },
        { status: 422 }
      );
    }
    const results = await getCandleBatch(
      session.user.id,
      parsed.data.requests
    );
    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error, "charts/candles/batch");
  }
}
