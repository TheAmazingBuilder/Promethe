import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createTrade, listTrades } from "@/server/trades";
import {
  tradeInputSchema,
  tradeListQuerySchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET  /api/trades — paginated, filterable list (scoped by session user).
 * POST /api/trades — create; IDEMPOTENT by clientMutationId (v2 §4.2).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = tradeListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Filtres invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await listTrades(session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "trades");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = tradeInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await createTrade(session.user.id, parsed.data);
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return apiError(error, "trades");
  }
}
