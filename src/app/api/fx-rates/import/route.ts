import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { importFxRatesCsv } from "@/server/tools";
import {
  fxRatesImportSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * POST /api/fx-rates/import - CSV import, parsed server-side.
 * Body: { csv }. Lines: `base,quote,taux` or `paire,taux`.
 * Returns { imported, errors } (bad lines are skipped, not fatal).
 */
export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = fxRatesImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const result = await importFxRatesCsv(session.user.id, parsed.data.csv);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "fx-rates/import");
  }
}
