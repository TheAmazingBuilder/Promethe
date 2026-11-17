import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getCandleWindow } from "@/server/charts";
import { candleWindowQuerySchema } from "@/lib/validations/charts";

/**
 * GET /api/charts/candles?instrumentId&timeframe&from&to
 * Candle window at the finest stored timeframe ≤ the requested one.
 * The client resamples to the display timeframe (see /src/lib/charts/price.ts).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = candleWindowQuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid parameters." },
        { status: 422 }
      );
    }
    const payload = await getCandleWindow(session.user.id, parsed.data);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "INSTRUMENT_NOT_FOUND") {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Instrument not found." },
        { status: 404 }
      );
    }
    return apiError(error, "charts/candles");
  }
}
