/**
 * Active sessions — server-side (never imported by client code).
 *
 * AuthSession rows hold only a token id, the user id and two dates: no
 * device, browser or IP is ever recorded, so the UI shows the sign-in and
 * expiry dates honestly and says the device is not recorded.
 *
 * The raw token id is never sent to the client: each row is identified by
 * a short fingerprint (first 16 hex chars of sha256(token)). Revocation
 * matches on that fingerprint server-side. The current session can never
 * be revoked here — signing out is the way to end it.
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export interface SessionRow {
  /** Short public fingerprint — never the raw token. */
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** Deterministic fingerprint for a session token. */
export function sessionFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/** All sessions of the user, newest first, with the current one flagged. */
export async function listSessions(
  userId: string,
  currentToken: string | undefined
): Promise<SessionRow[]> {
  const rows = await db.authSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    fingerprint: sessionFingerprint(row.id),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: currentToken !== undefined && row.id === currentToken,
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
  if (currentToken !== undefined && target.id === currentToken) {
    return { ok: false, code: "CURRENT_SESSION" };
  }
  await db.authSession.delete({ where: { id: target.id } });
  return { ok: true };
}
