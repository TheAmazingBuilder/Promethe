import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { rateLimit, sweepRateLimits } from "@/lib/rate-limit";
import {
  tradeListQuerySchema,
  zodFieldErrors,
} from "@/lib/validations/shared";
import { exportTradesCsv } from "@/server/export";
import type { CsvLocale } from "@/lib/trading/csv-export";

/**
 * GET /api/trades/export — CSV download of the FILTERED trade list (same
 * filters as the list endpoint). ?lang=fr|en (default: fr) localizes the
 * headers. UTF-8 BOM + CRLF for Excel friendliness.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    sweepRateLimits();
    if (!rateLimit(`trades-export:${session.user.id}`, 10, 60 * 1000)) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Trop d'exports, patientez." },
        { status: 429 }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = tradeListQuerySchema.safeParse(raw);
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
    const lang = url.searchParams.get("lang") === "en" ? "en" : "fr";
    const { csv, count, truncated } = await exportTradesCsv(
      session.user.id,
      parsed.data,
      lang satisfies CsvLocale
    );

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trades-${today}.csv"`,
        "X-Trades-Count": String(count),
        ...(truncated ? { "X-Trades-Truncated": "true" } : {}),
      },
    });
  } catch (error) {
    return apiError(error, "trades/export");
  }
}
