import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { listFxRates, upsertFxRate } from "@/server/tools";
import {
  fxRateInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET  /api/fx-rates - manual / CSV-imported rates (1 base = rate quote).
 * POST /api/fx-rates - upsert by pair (re-adding a pair updates its rate).
 */
export async function GET() {
  try {
    const session = await requireUser();
    const rates = await listFxRates(session.user.id);
    return NextResponse.json({ rates });
  } catch (error) {
    return apiError(error, "fx-rates");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = fxRateInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const rate = await upsertFxRate(session.user.id, parsed.data);
    return NextResponse.json({ rate }, { status: 201 });
  } catch (error) {
    return apiError(error, "fx-rates");
  }
}
