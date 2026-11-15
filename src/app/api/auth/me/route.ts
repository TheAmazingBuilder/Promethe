import { NextResponse } from "next/server";
import { getSession } from "@/server/session";

/**
 * GET /api/auth/me — current session, used by the SPA to refresh its state.
 * 200 { user, profile } · 401 UNAUTHORIZED
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Session absente ou expirée." },
        { status: 401 }
      );
    }
    return NextResponse.json(session);
  } catch (error) {
    console.error("[api/auth/me] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "Une erreur est survenue." },
      { status: 500 }
    );
  }
}
