import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  deleteSavedView,
  updateSavedView,
} from "@/server/reference";
import {
  savedViewPatchSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * PATCH  /api/saved-views/[id] — rename, pin, set default, reorder, or
 * replace the stored state (filters, columns, sort, grouping).
 * DELETE /api/saved-views/[id]
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = savedViewPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const view = await updateSavedView(session.user.id, id, parsed.data);
    if (!view) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "View not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ view });
  } catch (error) {
    return apiError(error, "saved-views/[id]");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteSavedView(session.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "View not found." },
        { status: 404 }
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "saved-views/[id]");
  }
}
