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
