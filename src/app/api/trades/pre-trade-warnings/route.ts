import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { zodFieldErrors } from "@/lib/validations/shared";
import {
  checkPreTradeWarnings,
  preTradeWarningsSchema,
} from "@/server/pre-trade-warnings";

/**
 * POST /api/trades/pre-trade-warnings — advisory warnings for a trade
 * draft (Lot 11, roadmap §14): unchecked required checklist items,
 * risk above the per-trade limit, planned R:R below the minimum, or a
 * day-trade count above the daily limit. Warnings NEVER block the save;
 * the form shows them and the user confirms explicitly.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = preTradeWarningsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 },
      );
    }
    const warnings = await checkPreTradeWarnings(session.user.id, parsed.data);
    return NextResponse.json({ warnings });
  } catch (error) {
    return apiError(error, "trades/pre-trade-warnings");
  }
}
