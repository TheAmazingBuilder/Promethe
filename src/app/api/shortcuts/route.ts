import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  listShortcuts,
  resetShortcuts,
  upsertShortcut,
} from "@/server/shortcuts";
import {
  shortcutUpsertSchema,
  zodFieldErrors,
} from "@/lib/validations/shared";

/**
 * GET    /api/shortcuts - effective chords (defaults + stored overrides).
 * PUT    /api/shortcuts - upsert one override (default chord deletes it).
 * DELETE /api/shortcuts - reset all overrides to the registry defaults.
 */
export async function GET() {
  try {
    const session = await requireUser();
    const shortcuts = await listShortcuts(session.user.id);
    return NextResponse.json({ shortcuts });
  } catch (error) {
    return apiError(error, "shortcuts");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = shortcutUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Invalid shortcut.", fieldErrors: zodFieldErrors(parsed.error) },
        { status: 422 }
      );
    }
    const shortcut = await upsertShortcut(
      session.user.id,
      parsed.data.actionId,
      parsed.data.keys
    );
    return NextResponse.json({ shortcut });
  } catch (error) {
    if (error instanceof Error && error.message === "ACTION_NOT_EDITABLE") {
      return NextResponse.json(
        { error: "ACTION_NOT_EDITABLE", message: "This shortcut cannot be changed here." },
        { status: 422 }
      );
    }
    return apiError(error, "shortcuts");
  }
}

export async function DELETE() {
  try {
    const session = await requireUser();
    await resetShortcuts(session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error, "shortcuts");
  }
}
