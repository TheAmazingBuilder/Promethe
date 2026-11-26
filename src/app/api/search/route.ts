import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { globalSearch } from "@/server/search";
import { searchQuerySchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET /api/search?q=…&limit=8 - global search over trades, strategies
 * and journal entries (folded searchText, accent-insensitive).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = searchQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid search.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await globalSearch(
      session.user.id,
      parsed.data.q,
      parsed.data.limit,
      parsed.data.offset
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "search");
  }
}
