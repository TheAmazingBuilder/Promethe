/**
 * GET    /api/account/deletion — current scheduled-deletion state (banner).
 * POST   /api/account/deletion — schedule deletion { password } (+7 d grace).
 * DELETE /api/account/deletion — cancel a pending deletion.
 * 200 · 401 · 403 BAD_PASSWORD · 409 ALREADY_PENDING
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import {
  cancelAccountDeletion,
  getDeletionState,
  scheduleAccountDeletion,
} from "@/server/account-deletion";

export async function GET() {
  try {
    const session = await requireUser();
    const state = await getDeletionState(session.user.id);
    return NextResponse.json({ state });
  } catch (error) {
    return apiError(error, "account/deletion");
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const body = (await req.json().catch(() => null)) as {
      password?: string;
    } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Mot de passe requis." },
        { status: 422 }
      );
    }

    const result = await scheduleAccountDeletion(session.user.id, password);
    if (!result.ok) {
      const status = result.code === "BAD_PASSWORD" ? 403 : 409;
      const message =
        result.code === "BAD_PASSWORD"
          ? "Mot de passe incorrect."
          : "Une suppression est déjà programmée.";
      return NextResponse.json({ error: result.code, message }, { status });
    }
    return NextResponse.json({ state: result.state });
  } catch (error) {
    return apiError(error, "account/deletion");
  }
}

export async function DELETE() {
  try {
    const session = await requireUser();
    const cancelled = await cancelAccountDeletion(session.user.id);
    if (!cancelled) {
      return NextResponse.json(
        {
          error: "NO_PENDING_REQUEST",
          message: "Aucune suppression en attente.",
        },
        { status: 409 }
      );
    }
    const state = await getDeletionState(session.user.id);
    return NextResponse.json({ state });
  } catch (error) {
    return apiError(error, "account/deletion");
  }
}
