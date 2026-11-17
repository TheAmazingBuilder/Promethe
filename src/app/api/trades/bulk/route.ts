import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { bulkUpdateTrades, BulkValidationError } from "@/server/bulk-trades";
import { bulkTradesSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * POST /api/trades/bulk - one transaction for the whole selection, one
 * ChangeLog group for undo. Returns { groupId, count, action }.
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = bulkTradesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Sélection invalide.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await bulkUpdateTrades(session.user.id, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof BulkValidationError) {
      const messages: Record<string, string> = {
        STRATEGY_NOT_FOUND: "Stratégie introuvable.",
        ACCOUNT_NOT_FOUND: "Compte introuvable.",
        TAG_NOT_FOUND: "Tag introuvable.",
        TRADE_NOT_FOUND: "Aucun trade sélectionné trouvé.",
      };
      return NextResponse.json(
        { error: error.message, message: messages[error.message] ?? "Requête invalide." },
        { status: 422 }
      );
    }
    return apiError(error, "trades/bulk");
  }
}
