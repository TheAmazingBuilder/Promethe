import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { googleRedirectUri, verifiedGoogleEmail } from "@/lib/auth/google";
import { constantTimeEqual } from "@/lib/tokens";
import { createSession } from "@/server/session";
import { createUserWithDefaults } from "@/server/users";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALLBACK_COOKIE_PATH = "/api/auth/google/callback";

function cookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}

function clearOAuthCookies(response: NextResponse): NextResponse {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: CALLBACK_COOKIE_PATH,
    maxAge: 0,
  };
  response.cookies.set("google_oauth_state", "", options);
  response.cookies.set("google_oauth_verifier", "", options);
  return response;
}

/**
 * GET /api/auth/google/callback?code=...&state=...
 * Validates state and the PKCE verifier before exchanging the authorization
 * code. Only an explicitly verified Google email may be linked to an account.
 */
export async function GET(req: Request) {
  const home = new URL("/", req.url);
  const fail = () => clearOAuthCookies(NextResponse.redirect(home));

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = googleRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) return fail();

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = cookieValue(req, "google_oauth_state");
    const codeVerifier = cookieValue(req, "google_oauth_verifier");

    if (
      !code ||
      !state ||
      !cookieState ||
      !codeVerifier ||
      !constantTimeEqual(state, cookieState)
    ) {
      return fail();
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) return fail();

    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail();

    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) return fail();

    const profile = (await profileRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    const email = verifiedGoogleEmail(profile);
    if (!email) return fail();

    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      await createSession(existing.id);
    } else {
      const displayName =
        profile.name?.trim() ||
        email.split("@")[0].slice(0, 60) ||
        "Trader";
      const created = await createUserWithDefaults({
        email,
        // Unusable random password: this account signs in with Google only.
        password: randomBytes(32).toString("hex"),
        displayName,
        timezone: "UTC",
        baseCurrency: "USD",
        locale: "en",
      });
      await createSession(created.user.id);
    }

    return clearOAuthCookies(NextResponse.redirect(home));
  } catch (error) {
    console.error("[api/auth/google/callback] failed:", error);
    return fail();
  }
}
