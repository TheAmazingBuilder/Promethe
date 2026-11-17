import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  createMarketSessionSetting,
  listMarketSessionSettings,
  resetMarketSessionSettings,
} from "@/server/tools";
import {
  marketSessionSettingInputSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET    /api/market-sessions?kind=DISPLAY - stored session rows (the code
 *          defaults apply for any session with no stored row).
 * POST   /api/market-sessions - create one row.
 * DELETE /api/market-sessions - delete all rows (restore the defaults).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const kind = new URL(req.url).searchParams.get("kind") ?? undefined;
    const settings = await listMarketSessionSettings(session.user.id, kind);
    return NextResponse.json({ settings });
  } catch (error) {
    return apiError(error, "market-sessions");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = marketSessionSettingInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const setting = await createMarketSessionSetting(session.user.id, parsed.data);
    return NextResponse.json({ setting }, { status: 201 });
  } catch (error) {
    return apiError(error, "market-sessions");
  }
}

export async function DELETE() {
  try {
    const session = await requireUser();
    const deleted = await resetMarketSessionSettings(session.user.id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return apiError(error, "market-sessions");
  }
}
