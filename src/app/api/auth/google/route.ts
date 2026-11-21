import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleCodeChallenge, googleRedirectUri } from "@/lib/auth/google";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALLBACK_COOKIE_PATH = "/api/auth/google/callback";
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

/**
 * GET /api/auth/google
 * Starts the Google sign-in flow with a CSRF state token and PKCE S256.
 * The callback URI is explicit in production and cannot be overridden by
 * an untrusted request Host header.
 */
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = googleRedirectUri();

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: "GOOGLE_NOT_CONFIGURED",
        message:
          "Google sign-in requires GOOGLE_CLIENT_ID and a valid GOOGLE_REDIRECT_URI.",
      },
      { status: 503 }
    );
  }

  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", googleCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: CALLBACK_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };

  res.cookies.set("google_oauth_state", state, cookieOptions);
  res.cookies.set("google_oauth_verifier", codeVerifier, cookieOptions);

  return res;
}
