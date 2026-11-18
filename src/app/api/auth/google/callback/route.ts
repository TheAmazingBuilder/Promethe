import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/server/session";
import { createUserWithDefaults } from "@/server/users";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * GET /api/auth/google/callback?code=...&state=...
 * Finishes the Google sign-in flow:
 * 1. Checks the `state` against the cookie set when the flow started.
 * 2. Exchanges the code for an access token.
 * 3. Fetches the Google profile (verified email + name).
 * 4. Links by email: existing account signs in, new email creates an
 *    account (with an unusable random password - Google is the way in)
 *    plus the usual profile and default trading account.
 * 5. Creates a Promethe session (same cookie as email/password login)
 *    and redirects home.
 */
export async function GET(req: Request) {
  const home = new URL("/", req.url);
  const fail = () => NextResponse.redirect(home);

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail();

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("google_oauth_state="))
      ?.split("=")[1];
    if (!code || !state || !cookieState || state !== cookieState) return fail();

    const redirectUri = new URL("/api/auth/google/callback", req.url).toString();

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return fail();
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail();

    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) return fail();
    const profile = (await profileRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    const email = profile.email?.toLowerCase().trim();
    if (!email || profile.email_verified === false) return fail();

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

    const res = NextResponse.redirect(home);
    res.cookies.set("google_oauth_state", "", { path: "/api/auth/google/callback", maxAge: 0 });
    return res;
  } catch (error) {
    console.error("[api/auth/google/callback] failed:", error);
    return fail();
  }
}
