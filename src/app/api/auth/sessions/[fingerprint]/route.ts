/**
 * DELETE /api/auth/sessions/[fingerprint] — revoke one session.
 * The current session cannot be revoked here (sign out instead).
 * 200 { revoked: true } · 401 UNAUTHORIZED · 404 NOT_FOUND · 409 CURRENT_SESSION
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, SESSION_COOKIE, UnauthorizedError } from "@/server/session";
import { apiError } from "@/server/api";
import { revokeSession } from "@/server/auth-sessions";

type Ctx = { params: Promise<{ fingerprint: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await requireUser();
    const { fingerprint } = await ctx.params;
    const jar = await cookies();
    const currentToken = jar.get(SESSION_COOKIE)?.value;
    const result = await revokeSession(session.user.id, fingerprint, currentToken);
    if (!result.ok) {
      if (result.code === "CURRENT_SESSION") {
        return NextResponse.json(
          {
            error: "CURRENT_SESSION",
            message: "This is your current session. Sign out to end it.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Session not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session missing or expired." },
        { status: 401 }
      );
    }
    return apiError(error, "auth/sessions/[fingerprint]");
  }
}
