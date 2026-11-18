import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  getTableColumnPreference,
  saveTableColumnPreference,
} from "@/server/table-columns";
import {
  tableColumnsInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET /api/table-columns?tableKey=trades - stored layout (null when none).
 * PUT /api/table-columns - save the full order + visibility map.
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const tableKey = new URL(req.url).searchParams.get("tableKey") ?? "trades";
    const preference = await getTableColumnPreference(session.user.id, tableKey);
    return NextResponse.json({ preference });
  } catch (error) {
    return apiError(error, "table-columns");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = tableColumnsInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Colonnes invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const preference = await saveTableColumnPreference(session.user.id, parsed.data);
    return NextResponse.json({ preference });
  } catch (error) {
    return apiError(error, "table-columns");
  }
}
