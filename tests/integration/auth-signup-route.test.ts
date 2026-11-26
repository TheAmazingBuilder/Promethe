/**
 * Lot 16 — Signup route (E2E journey 1 at the route layer).
 *
 * The registration flow had no route-level test: users were only ever
 * created through createUserWithDefaults in beforeAll hooks. These tests
 * drive POST /api/auth/signup itself — validation, duplicate email, the
 * 201 payload and the session cookie set right after signup.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name)
        ? { name, value: cookieStore.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db } from "@/lib/db";
import { POST as signup } from "@/app/api/auth/signup/route";

const EMAIL = "lot16-signup@test.local";
const PASSWORD = "Signup1234";

async function postSignup(body: unknown) {
  return signup(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeAll(async () => {
  cookieStore.clear();
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe("POST /api/auth/signup", () => {
  it("creates the user, records consents and sets a session cookie (201)", async () => {
    const res = await postSignup({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Lot 16 Trader",
      timezone: "America/Toronto",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect((body.user as { email: string }).email).toBe(EMAIL);
    // A session is usable right after signup: the cookie is set.
    expect(cookieStore.has("tj_session")).toBe(true);

    const row = await db.user.findUnique({ where: { email: EMAIL } });
    expect(row).not.toBeNull();
    const consents = await db.consentRecord.findMany({
      where: { userId: row!.id },
    });
    expect(consents.map((c) => c.type).sort()).toEqual(["PRIVACY", "TERMS"]);
  });

  it("rejects an invalid email with 422 VALIDATION + fieldErrors", async () => {
    const res = await postSignup({
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error).toBe("VALIDATION");
    expect(body.fieldErrors).toHaveProperty("email");
  });

  it("rejects a password without a digit with 422 VALIDATION", async () => {
    const res = await postSignup({
      email: "lot16-weak@test.local",
      password: "PasswordNoDigit",
    });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error).toBe("VALIDATION");
    expect(body.fieldErrors).toHaveProperty("password");
  });

  it("rejects a duplicate email with 409 EMAIL_TAKEN", async () => {
    const res = await postSignup({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("EMAIL_TAKEN");
  });
});
