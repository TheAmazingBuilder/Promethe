/**
 * GET    /api/account/deletion — current scheduled-deletion state (banner).
 * POST   /api/account/deletion — schedule deletion { password } (+7 d grace).
 * DELETE /api/account/deletion — cancel a pending deletion.
 * 200 · 401 · 403 BAD_PASSWORD · 409 ALREADY_PENDING
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/server/session";
import { apiError } from "@/server/api";
import { checkReauthRateLimit } from "@/server/reauth-rate-limit";
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
    if (!password || password.length > 128) {
      return NextResponse.json(
        { error: "VALIDATION", message: "Password must contain between 1 and 128 characters." },
        { status: 422 }
      );
    }

    const rateLimit = await checkReauthRateLimit(session.user.id, req.headers);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many password attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const result = await scheduleAccountDeletion(session.user.id, password);
    if (!result.ok) {
      const status = result.code === "BAD_PASSWORD" ? 403 : 409;
      const message =
        result.code === "BAD_PASSWORD"
          ? "Incorrect password."
          : "A deletion is already scheduled.";
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
          message: "No pending deletion.",
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
