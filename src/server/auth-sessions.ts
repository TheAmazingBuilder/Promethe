/**
 * Active sessions — server-side (never imported by client code).
 *
 * AuthSession rows contain a versioned SHA-256 digest of the bearer token,
 * the user id and two dates: no device, browser or IP is ever recorded.
 * The raw token is never sent to the client: each row is identified by a
 * short SHA-256 fingerprint. Revocation matches on that fingerprint.
 */
import { db } from "@/lib/db";
import {
  sessionFingerprint,
  storedSessionMatchesToken,
} from "@/lib/auth/session-token";

// Keep the established server helper export used by security tests and callers.
export { sessionFingerprint };

export interface SessionRow {
  /** Short public fingerprint — never the raw token. */
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** All sessions of the user, newest first, with the current one flagged. */
export async function listSessions(
  userId: string,
  currentToken: string | undefined
): Promise<SessionRow[]> {
  // Expired rows are not active sessions: they never appear in the list
  // (they are purged opportunistically on login and on read).
  const now = new Date();
  const rows = await db.authSession.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    fingerprint: sessionFingerprint(row.id),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: currentToken !== undefined && storedSessionMatchesToken(row.id, currentToken),
  }));
}

export type RevokeSessionResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "CURRENT_SESSION" };

/** Deletes one session by fingerprint. Never the current session. */
export async function revokeSession(
  userId: string,
  fingerprint: string,
  currentToken: string | undefined
): Promise<RevokeSessionResult> {
  const rows = await db.authSession.findMany({ where: { userId } });
  const target = rows.find((row) => sessionFingerprint(row.id) === fingerprint);
  if (!target) return { ok: false, code: "NOT_FOUND" };
  if (currentToken !== undefined && storedSessionMatchesToken(target.id, currentToken)) {
    return { ok: false, code: "CURRENT_SESSION" };
  }
  await db.authSession.delete({ where: { id: target.id } });
  return { ok: true };
}
