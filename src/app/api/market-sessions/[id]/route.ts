import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteMarketSessionSetting,
  updateMarketSessionSetting,
} from "@/server/tools";
import {
  marketSessionSettingPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/market-sessions/[id] - edit a stored session row.
 * DELETE /api/market-sessions/[id] - drop one row (its default applies again).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = marketSessionSettingPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const setting = await updateMarketSessionSetting(session.user.id, id, parsed.data);
    if (!setting) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Session introuvable." },
        { status: 404 }
      );
    }
    return NextResponse.json({ setting });
  } catch (error) {
    return apiError(error, "market-sessions/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteMarketSessionSetting(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Session introuvable." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "market-sessions/[id]");
  }
}
