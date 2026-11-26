/**
 * Lot 15 — Session lifecycle integration tests (PostgreSQL schema promethe_test).
 *
 * Proves the §19 session contract against a real database:
 *  - creation sets a secure cookie (httpOnly, SameSite=Lax, path, 30-day
 *    lifetime matching the DB row) and stores only a SHA-256 digest
 *  - an expired session resolves to null AND its row is purged on read
 *  - a legacy raw-token row is upgraded to a digest in place, then resolves
 *  - logout deletes the DB row and clears the cookie (server-side, not
 *    client-side only)
 *  - the active-session list shows fingerprints only (never a raw token),
 *    excludes expired rows, and revocation is immediate, per-user and
 *    refuses the current session
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
// The jar records the options passed to set() so the cookie attributes can
// be asserted; delete() is observable too.
const cookieStore = vi.hoisted(
  () => new Map<string, { value: string; options?: Record<string, unknown> }>()
);
const deletedCookies = vi.hoisted(() => new Set<string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const row = cookieStore.get(name);
      return row ? { name, value: row.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieStore.set(name, { value, options });
      deletedCookies.delete(name);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
      deletedCookies.add(name);
    },
  }),
}));

import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  getSession,
  SESSION_COOKIE,
} from "@/server/session";
import { listSessions, revokeSession } from "@/server/auth-sessions";
import { hashSessionToken, sessionFingerprint } from "@/lib/auth/session-token";
import { createUserWithDefaults } from "@/server/users";

let aliceId: string;
let bobId: string;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const alice = await createUserWithDefaults({
    email: "alice-sessions@test.local",
    password: "password1",
    displayName: "Alice Sessions",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  const bob = await createUserWithDefaults({
    email: "bob-sessions@test.local",
    password: "password1",
    displayName: "Bob Sessions",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  aliceId = alice.user.id;
  bobId = bob.user.id;
});

afterAll(async () => {
  // Cascade deletes sessions and every other row of these users.
  await db.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } });
});

/** Creates a session and returns the raw bearer token from the cookie jar. */
async function newSession(userId: string): Promise<string> {
  cookieStore.clear();
  deletedCookies.clear();
  await createSession(userId);
  const row = cookieStore.get(SESSION_COOKIE);
  expect(row, "createSession must set the session cookie").toBeDefined();
  return row!.value;
}

/** Presents a raw token as the current cookie (as another device would). */
function presentToken(token: string): void {
  cookieStore.clear();
  deletedCookies.clear();
  cookieStore.set(SESSION_COOKIE, { value: token });
}

/** Inserts a session row directly (lets tests forge expired/legacy rows). */
async function insertSessionRow(
  userId: string,
  rawToken: string,
  expiresAt: Date,
  hashed = true
): Promise<void> {
  await db.authSession.create({
    data: {
      id: hashed ? hashSessionToken(rawToken) : rawToken,
      userId,
      expiresAt,
    },
  });
}

describe("session creation (cookie attributes + digest storage)", () => {
  it("sets an httpOnly SameSite=Lax cookie whose lifetime matches the DB row", async () => {
    const before = Date.now();
    const token = await newSession(aliceId);
    const jarRow = cookieStore.get(SESSION_COOKIE)!;

    expect(jarRow.options?.httpOnly).toBe(true);
    expect(jarRow.options?.sameSite).toBe("lax");
    expect(jarRow.options?.path).toBe("/");
    expect(jarRow.options?.maxAge).toBe(30 * 24 * 60 * 60);
    // Secure only in production (plain HTTP on localhost/test must still work).
    expect(jarRow.options?.secure).toBe(false);

    const stored = await db.authSession.findFirst({ where: { userId: aliceId } });
    expect(stored).not.toBeNull();
    // The DB never holds the raw bearer token, only its versioned digest.
    expect(stored!.id).toBe(hashSessionToken(token));
    expect(stored!.id).not.toContain(token);
    const ttl = stored!.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(THIRTY_DAYS_MS - 60_000);
    // A few ms above 30 days: expiresAt is computed inside createSession,
    // just after `before` was captured.
    expect(ttl).toBeLessThanOrEqual(THIRTY_DAYS_MS + 60_000);
  });
});

describe("session resolution (expiry + legacy upgrade)", () => {
  it("resolves a live session to its own user only", async () => {
    const token = await newSession(aliceId);
    presentToken(token);
    const session = await getSession();
    expect(session?.user.id).toBe(aliceId);
    expect(session?.user.email).toBe("alice-sessions@test.local");
  });

  it("an unknown token resolves to null", async () => {
    presentToken("a".repeat(64));
    expect(await getSession()).toBeNull();
  });

  it("an expired session resolves to null AND its row is purged on read", async () => {
    const raw = randomBytes(32).toString("hex");
    await insertSessionRow(
      aliceId,
      raw,
      new Date(Date.now() - 60_000) // expired a minute ago
    );
    presentToken(raw);
    expect(await getSession()).toBeNull();
    const leftover = await db.authSession.findUnique({
      where: { id: hashSessionToken(raw) },
    });
    expect(leftover).toBeNull();
  });

  it("a legacy raw-token row is upgraded to a digest in place, then resolves", async () => {
    const raw = randomBytes(32).toString("hex");
    await insertSessionRow(
      aliceId,
      raw,
      new Date(Date.now() + THIRTY_DAYS_MS),
      false // legacy: the id IS the raw token
    );
    presentToken(raw);
    const session = await getSession();
    expect(session?.user.id).toBe(aliceId);
    const upgraded = await db.authSession.findUnique({
      where: { id: hashSessionToken(raw) },
    });
    expect(upgraded).not.toBeNull();
    expect(
      await db.authSession.findUnique({ where: { id: raw } })
    ).toBeNull();
  });
});

describe("logout (server-side revocation, not client-side only)", () => {
  it("deletes the DB row and clears the cookie", async () => {
    const token = await newSession(aliceId);
    presentToken(token);
    expect(await getSession()).not.toBeNull();

    await destroySession();

    expect(cookieStore.has(SESSION_COOKIE)).toBe(false);
    expect(deletedCookies.has(SESSION_COOKIE)).toBe(true);
    expect(
      await db.authSession.findUnique({
        where: { id: hashSessionToken(token) },
      })
    ).toBeNull();
    expect(await getSession()).toBeNull();
  });
});

describe("active sessions (list + revoke)", () => {
  it("lists fingerprints only, flags the current session, hides expired rows", async () => {
    // Clean slate: earlier tests in this file left live sessions behind.
    await db.authSession.deleteMany({ where: { userId: aliceId } });
    // Two live sessions (two "devices") + one expired row.
    const first = await newSession(aliceId);
    const second = await newSession(aliceId);
    const expiredRaw = randomBytes(32).toString("hex");
    await insertSessionRow(
      aliceId,
      expiredRaw,
      new Date(Date.now() - 60_000)
    );

    const rows = await listSessions(aliceId, second);
    expect(rows).toHaveLength(2);
    const current = rows.filter((r) => r.current);
    expect(current).toHaveLength(1);
    expect(current[0].fingerprint).toBe(
      sessionFingerprint(hashSessionToken(second))
    );
    for (const row of rows) {
      expect(row.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(row.fingerprint).not.toContain(first);
      expect(row.fingerprint).not.toContain(second);
    }
    // The expired row never appears.
    expect(
      rows.some(
        (r) =>
          r.fingerprint === sessionFingerprint(hashSessionToken(expiredRaw))
      )
    ).toBe(false);
  });

  it("revocation is immediate and per-user; the current session cannot be revoked", async () => {
    // Clean slate: earlier tests in this file left live sessions behind.
    await db.authSession.deleteMany({
      where: { userId: { in: [aliceId, bobId] } },
    });
    const victim = await newSession(aliceId);
    const current = await newSession(aliceId);
    const bobToken = await newSession(bobId);

    const aliceRows = await listSessions(aliceId, current);
    const victimRow = aliceRows.find(
      (r) => r.fingerprint === sessionFingerprint(hashSessionToken(victim))
    );
    expect(victimRow).toBeDefined();

    // Unknown fingerprint: nothing happens.
    expect(
      await revokeSession(aliceId, "0".repeat(16), current)
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    // Another user's session: not found from here, and untouched.
    expect(
      await revokeSession(
        aliceId,
        sessionFingerprint(hashSessionToken(bobToken)),
        current
      )
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await db.authSession.findUnique({
        where: { id: hashSessionToken(bobToken) },
      })
    ).not.toBeNull();
    // The current session cannot be revoked (use logout for that).
    expect(
      await revokeSession(
        aliceId,
        sessionFingerprint(hashSessionToken(current)),
        current
      )
    ).toEqual({ ok: false, code: "CURRENT_SESSION" });

    // Revoking the other session works, and the token stops resolving at once.
    expect(
      await revokeSession(aliceId, victimRow!.fingerprint, current)
    ).toEqual({ ok: true });
    expect(
      await db.authSession.findUnique({
        where: { id: hashSessionToken(victim) },
      })
    ).toBeNull();
    presentToken(victim);
    expect(await getSession()).toBeNull();
    // The current session still resolves.
    presentToken(current);
    expect((await getSession())?.user.id).toBe(aliceId);
  });
});
