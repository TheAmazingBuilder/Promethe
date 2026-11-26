import { createHash } from "node:crypto";

/**
 * Resolve the one callback URL registered in Google Cloud.
 * Production never trusts the incoming Host header to construct this URL.
 */
export function googleRedirectUri(): string | null {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (!configured) {
    return process.env.NODE_ENV === "production"
      ? null
      : "http://localhost:3000/api/auth/google/callback";
  }

  try {
    const url = new URL(configured);
    const isLocalhost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";

    if (
      (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) ||
      url.pathname !== "/api/auth/google/callback" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/** RFC 7636 S256 code challenge for OAuth Authorization Code + PKCE. */
export function googleCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Accept an OAuth email only when the provider explicitly asserts that it
 * has been verified. Missing verification metadata is not trusted.
 */
export function verifiedGoogleEmail(profile: {
  email?: unknown;
  email_verified?: unknown;
}): string | null {
  if (profile.email_verified !== true || typeof profile.email !== "string") {
    return null;
  }
  const email = profile.email.trim().toLowerCase();
  return email.length > 0 ? email : null;
}
