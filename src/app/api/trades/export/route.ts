import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hashRateLimitIdentifier } from "@/lib/tokens";
import {
  tradeListQuerySchema,
  zodFieldErrors,
} from "@/lib/validations/shared";
import { exportTradesCsv } from "@/server/export";

/**
 * GET /api/trades/export — CSV download of the FILTERED trade list (same
 * filters as the list endpoint). English headers, always. UTF-8 BOM + CRLF
 * for Excel friendliness.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const exportLimit = await consumeRateLimit(
      `trades-export:${hashRateLimitIdentifier("trades-export-user", session.user.id)}`,
      10,
      60 * 1000
    );
    if (!exportLimit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many exports, please wait." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil((exportLimit.resetAt - Date.now()) / 1000))),
          },
        }
      );
    }
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = tradeListQuerySchema.safeParse(raw);
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
    const { csv, count, truncated } = await exportTradesCsv(
      session.user.id,
      parsed.data
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
