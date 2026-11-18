/**
 * GET /api/auth/sessions — the user's active sessions (AuthSession rows).
 * Each row carries a short fingerprint, the sign-in date and the expiry
 * date — never the raw token, and no device or browser is recorded.
 * 200 { sessions: SessionRow[] } · 401 UNAUTHORIZED
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, SESSION_COOKIE, UnauthorizedError } from "@/server/session";
import { apiError } from "@/server/api";
import { listSessions } from "@/server/auth-sessions";

export async function GET() {
  try {
    const session = await requireUser();
    const jar = await cookies();
    const currentToken = jar.get(SESSION_COOKIE)?.value;
    const sessions = await listSessions(session.user.id, currentToken);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session missing or expired." },
        { status: 401 }
      );
    }
    return apiError(error, "auth/sessions");
  }
}
