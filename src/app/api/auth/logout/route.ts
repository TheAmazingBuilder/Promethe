import { NextResponse } from "next/server";
import { destroySession } from "@/server/session";

/**
 * POST /api/auth/logout — revokes the DB session and clears the cookie.
 * 204 (idempotent) · 500
 */
export async function POST() {
  try {
    await destroySession();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[api/auth/logout] failed:", error);
    return NextResponse.json(
      { error: "INTERNAL", message: "Could not sign out. Please try again." },
      { status: 500 }
    );
  }
}
