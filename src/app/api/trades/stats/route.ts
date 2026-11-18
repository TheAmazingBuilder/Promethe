import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { getGridStats } from "@/server/trades";
import {
  tradeListQuerySchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET /api/trades/stats — header stats over the WHOLE filtered set
 * (grid view). Same filters as the list endpoint, aggregated in SQL —
 * no page loop on the client. Pagination/sort params are accepted and
 * ignored: the stats cover the full set, not one page.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
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
    const result = await getGridStats(session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "trades/stats");
  }
}
