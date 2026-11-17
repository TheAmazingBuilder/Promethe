import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { importCandles } from "@/server/charts";
import { candleImportSchema } from "@/lib/validations/charts";
import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * POST /api/charts/candles/import — CSV candle import with a DECLARED
 * timezone for the timestamps (converted to UTC before storage).
 * Caps: 50k rows/import, 250k rows/instrument+timeframe budget with pruning.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = candleImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION",
          message: "Invalid import.",
          fieldErrors: zodFieldErrors(parsed.error),
        },
        { status: 422 }
      );
    }
    const result = await importCandles(session.user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const known = [
      "INSTRUMENT_NOT_FOUND",
      "INVALID_TIMEZONE",
      "EMPTY_CSV",
      "TOO_MANY_ROWS",
      "NO_VALID_ROWS",
    ];
    if (error instanceof Error && known.includes(error.message)) {
      return NextResponse.json(
        { error: error.message, message: error.message },
        { status: 422 }
      );
    }
    return apiError(error, "charts/candles/import");
  }
}
