/**
 * Server-side session management: opaque random token in an httpOnly cookie,
 * backed by the AuthSession table (revocable, 30-day expiry).
 * Server-only: imports next/headers — never bundle for the client.
 *
 * The cookie retains the raw bearer token; AuthSession.id stores a versioned
 * SHA-256 digest. Legacy rows are upgraded lazily on successful access.
 *
 * CSRF posture (no middleware, lot 15): the cookie is SameSite=Lax, so a
 * cross-site POST never carries it, and NO authenticated GET route mutates
 * state (the full export is POST for exactly this reason; the only
 * state-changing GET is the Google OAuth callback, guarded by the state
 * parameter + PKCE). Enforced by tests/unit/csrf-posture.test.ts.
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/types";
import { toSessionPayload } from "@/server/users";
import { hashSessionToken } from "@/lib/auth/session-token";

export const SESSION_COOKIE = "tj_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 jours
const SESSION_TTL_MS = SESSION_TTL_S * 1000;

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

/** Creates a DB session and sets the httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.authSession.create({
    data: { id: hashSessionToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

/** Deletes the DB session (if any) and clears the cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.authSession
      .deleteMany({ where: { id: { in: [hashSessionToken(token), token] } } })
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Reads the current session (usable from RSC pages and route handlers).
 * Returns null when absent or expired — expired rows are purged on read.
 * A legacy raw-token row is upgraded in place before its user is returned.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const hashedId = hashSessionToken(token);
  let session = await db.authSession.findUnique({
    where: { id: hashedId },
    include: { user: { include: { profile: true } } },
  });

  if (!session) {
    const legacy = await db.authSession.findUnique({
      where: { id: token },
      include: { user: { include: { profile: true } } },
    });
    if (!legacy) return null;

    if (legacy.expiresAt.getTime() <= Date.now()) {
      await db.authSession.deleteMany({ where: { id: token } }).catch(() => undefined);
      return null;
    }

    // Atomic conditional update makes concurrent requests safe: only one
    // request changes the legacy primary key; all then read the hashed row.
    await db.authSession.updateMany({
      where: { id: token },
      data: { id: hashedId },
    });
    session = await db.authSession.findUnique({
      where: { id: hashedId },
      include: { user: { include: { profile: true } } },
    });
    if (!session) return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.authSession.delete({ where: { id: hashedId } }).catch(() => undefined);
    return null;
  }

  return toSessionPayload(session.user, session.user.profile);
}

/** Like getSession but throws UnauthorizedError - for data-access helpers. */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
