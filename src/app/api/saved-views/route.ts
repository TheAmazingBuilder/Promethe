import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { createSavedView, listSavedViews } from "@/server/reference";
import { savedViewInputSchema, zodFieldErrors } from "@/lib/validations/shared";

/**
 * GET  /api/saved-views?page=trades — named filter presets for a page.
 * POST /api/saved-views — upsert by (page, name).
 */
export async function GET(req: Request) {
  try {
    const session = await requireUser();
    const page = new URL(req.url).searchParams.get("page") ?? "trades";
    const views = await listSavedViews(session.user.id, page);
    return NextResponse.json({ views });
  } catch (error) {
    return apiError(error, "saved-views");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = savedViewInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Some fields are invalid.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const view = await createSavedView(session.user.id, parsed.data);
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    return apiError(error, "saved-views");
  }
}
