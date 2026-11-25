/**
 * Lot 16 — Trading-account routes (E2E journey 2 at the route layer).
 *
 * Accounts were only ever created through db.account.create / createAccount
 * in beforeAll hooks. These tests drive GET / POST /api/accounts and
 * PATCH / DELETE /api/accounts/[id] themselves — validation, ownership
 * (404 on another user's account) and the never-delete-with-trades rule.
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
import { createUserWithDefaults } from "@/server/users";
import { createSession } from "@/server/session";
import {
  DELETE as deleteAccount,
  PATCH as patchAccount,
} from "@/app/api/accounts/[id]/route";
import {
  GET as listAccounts,
  POST as createAccount,
} from "@/app/api/accounts/route";

let userA: { id: string };
let userB: { id: string };
let accountAId: string;
let accountBId: string;
let accountWithTradeId: string;

async function loginAs(userId: string) {
  cookieStore.clear();
  await createSession(userId);
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

function postAccount(body: unknown) {
  return createAccount(
    new Request("http://localhost/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function patchAccountById(id: string, body: unknown) {
  return patchAccount(
    new Request(`http://localhost/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function deleteAccountById(id: string) {
  return deleteAccount(
    new Request(`http://localhost/api/accounts/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "lot16-accounts-a@test.local",
    password: "Accounts1234",
    displayName: "Lot 16 A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "lot16-accounts-b@test.local",
    password: "Accounts1234",
    displayName: "Lot 16 B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  // One account with a trade (never deletable) for the delete guard test.
  await loginAs(userA.id);
  const withTrade = await json(
    await postAccount({ name: "With trade", type: "DEMO", currency: "USD" })
  );
  accountWithTradeId = (withTrade.account as { id: string }).id;
  const instrument = await db.instrument.create({
    data: { userId: userA.id, symbol: "XAUUSD", name: "Gold", assetClass: "METAL" },
  });
  await db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountWithTradeId,
      instrumentId: instrument.id,
      direction: "LONG",
      entryPrice: "2650.00",
      status: "OPEN",
      entryTime: new Date("2026-11-01T08:00:00Z"),
      source: "MANUAL",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("trading account routes", () => {
  it("GET without a session is 401 with a requestId", async () => {
    cookieStore.clear();
    const res = await listAccounts();
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error).toBe("UNAUTHORIZED");
    // Correlation id (§24): the client can quote it, the server log has it.
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("POST creates an account (201) and GET lists it", async () => {
    await loginAs(userA.id);
    const res = await postAccount({
      name: "Main DEMO",
      type: "DEMO",
      currency: "USD",
      initialBalance: "10000",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    accountAId = (body.account as { id: string }).id;
    expect((body.account as { name: string }).name).toBe("Main DEMO");

    const list = await json(await listAccounts());
    const ids = (list.accounts as { id: string }[]).map((a) => a.id);
    expect(ids).toContain(accountAId);
  });

  it("POST rejects an empty name and an unknown currency (422)", async () => {
    await loginAs(userA.id);
    const emptyName = await postAccount({ name: "", currency: "USD" });
    expect(emptyName.status).toBe(422);
    expect((await json(emptyName)).error).toBe("VALIDATION");
    const badCurrency = await postAccount({ name: "X", currency: "XXX" });
    expect(badCurrency.status).toBe(422);
    expect((await json(badCurrency)).error).toBe("VALIDATION");
  });

  it("PATCH renames my account, and 404s on another user's account", async () => {
    await loginAs(userB.id);
    const bRes = await postAccount({ name: "B account", currency: "EUR" });
    accountBId = ((await json(bRes)).account as { id: string }).id;

    await loginAs(userA.id);
    const renamed = await patchAccountById(accountAId, {
      name: "Main DEMO renamed",
    });
    expect(renamed.status).toBe(200);
    expect(((await json(renamed)).account as { name: string }).name).toBe(
      "Main DEMO renamed"
    );

    const foreign = await patchAccountById(accountBId, { name: "Hijacked" });
    expect(foreign.status).toBe(404);
    const stillThere = await db.account.findUnique({
      where: { id: accountBId },
    });
    expect(stillThere?.name).toBe("B account");
  });

  it("DELETE removes my empty account (204) but never one with trades (422)", async () => {
    await loginAs(userA.id);
    const del = await deleteAccountById(accountAId);
    expect(del.status).toBe(204);
    expect(
      await db.account.findUnique({ where: { id: accountAId } })
    ).toBeNull();

    const withTrade = await deleteAccountById(accountWithTradeId);
    expect(withTrade.status).toBe(422);
    expect((await json(withTrade)).error).toBe("TRADES_ON_ACCOUNT");
    expect(
      await db.account.findUnique({ where: { id: accountWithTradeId } })
    ).not.toBeNull();
  });

  it("DELETE on another user's account changes nothing", async () => {
    await loginAs(userA.id);
    const res = await deleteAccountById(accountBId);
    expect(res.status).toBe(422);
    expect(
      await db.account.findUnique({ where: { id: accountBId } })
    ).not.toBeNull();
  });
});
