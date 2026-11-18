import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * GET /api/auth/google
 * Starts the Google sign-in flow: redirects the user to Google with a
 * random `state` (stored in a short-lived httpOnly cookie, checked back
 * in the callback) to protect against CSRF.
 *
 * Requires GOOGLE_CLIENT_ID in .env. The redirect URI is derived from the
 * request origin, so it is http://localhost:3000/api/auth/google/callback
 * in dev and the deployed origin in production - both must be registered
 * in the Google Cloud OAuth client.
 */
export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        error: "GOOGLE_NOT_CONFIGURED",
        message: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID in .env.",
      },
      { status: 500 }
    );
  }

  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();
  const state = randomBytes(16).toString("hex");

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google/callback",
    maxAge: 10 * 60,
  });
  return res;
}
