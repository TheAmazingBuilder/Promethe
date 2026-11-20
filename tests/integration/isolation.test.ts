/**
 * Integration test — USER ISOLATION (addendum §11.8).
 *
 * Proves, against a dedicated PostgreSQL test schema (promethe_test), that
 * user A can never read, update or delete user B's data when the data-access
 * layer scopes by userId — the pattern every /src/server helper must follow:
 *
 *   read    → findMany/findFirst({ where: { …, userId } })
 *   update  → updateMany({ where: { id, userId } })
 *   delete  → deleteMany({ where: { id, userId } })
 *
 * Covers: accounts, strategies (+ checklists), trades, screenshots,
 * saved views, profiles, and session cookies. Trade/strategy API routes
 * (phase 3+) build directly on this pattern.
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
import { createSession, destroySession, getSession } from "@/server/session";
import {
  createUserWithDefaults,
  ensureUserSetup,
  updateProfile,
} from "@/server/users";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Or / Dollar US",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.10",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: "0.01",
  isActive: true,
};

let instrumentId: string;
let userA: { id: string; email: string };
let userB: { id: string; email: string };
let accountAId: string;
let accountBId: string;

beforeAll(async () => {
  // Global preset instrument (normally created by the seed).
  const instrument = await db.instrument.create({
    data: { userId: null, ...XAUUSD_SPEC },
  });
  instrumentId = instrument.id;

  const a = await createUserWithDefaults({
    email: "alice@test.local",
    password: "password1",
    displayName: "Alice",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "fr",
  });
  const b = await createUserWithDefaults({
    email: "bob@test.local",
    password: "password1",
    displayName: "Bob",
    timezone: "Europe/Paris",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  const accountsA = await db.account.findMany({ where: { userId: userA.id } });
  const accountsB = await db.account.findMany({ where: { userId: userB.id } });
  expect(accountsA).toHaveLength(1);
  expect(accountsB).toHaveLength(1);
  accountAId = accountsA[0].id;
  accountBId = accountsB[0].id;
  expect(accountAId).not.toBe(accountBId);
});

afterAll(async () => {
  if (userA?.id || userB?.id) {
    await db.user.deleteMany({
      where: { id: { in: [userA?.id, userB?.id].filter(Boolean) as string[] } },
    });
  }
  if (instrumentId) {
    await db.instrument.deleteMany({ where: { id: instrumentId } });
  }
  await db.$disconnect();
});

describe("profiles & accounts", () => {
  it("each user sees only their own accounts", async () => {
    const aAccounts = await db.account.findMany({
      where: { userId: userA.id },
      select: { id: true },
    });
    const bAccounts = await db.account.findMany({
      where: { userId: userB.id },
      select: { id: true },
    });
    expect(aAccounts.map((x) => x.id)).toEqual([accountAId]);
    expect(bAccounts.map((x) => x.id)).toEqual([accountBId]);
  });

  it("ensureUserSetup(A) returns A's profile — never B's", async () => {
    const payload = await ensureUserSetup(userA.id);
    expect(payload.user.id).toBe(userA.id);
    expect(payload.profile.displayName).toBe("Alice");
    expect(payload.profile.locale).toBe("fr");
  });

  it("updateProfile(B) never touches A's profile", async () => {
    await updateProfile(userB.id, { displayName: "Bobby" });
    const a = await ensureUserSetup(userA.id);
    expect(a.profile.displayName).toBe("Alice");
    const b = await ensureUserSetup(userB.id);
    expect(b.profile.displayName).toBe("Bobby");
  });
});

describe("sessions (httpOnly cookie → AuthSession)", () => {
  it("a session cookie resolves to its own user only", async () => {
    await createSession(userA.id);
    const asA = await getSession();
    expect(asA?.user.email).toBe("alice@test.local");

    await createSession(userB.id);
    const asB = await getSession();
    expect(asB?.user.email).toBe("bob@test.local");
  });

  it("an unknown/revoked token resolves to null", async () => {
    await createSession(userA.id);
    cookieStore.set("tj_session", "f".repeat(64)); // forged token
    expect(await getSession()).toBeNull();

    await createSession(userB.id);
    await destroySession();
    expect(await getSession()).toBeNull();
  });
});

describe("strategies & checklists", () => {
  it("B cannot read, update or delete A's strategy (scoped pattern)", async () => {
    const strategy = await db.strategy.create({
      data: {
        userId: userA.id,
        name: "Gold breakout",
        description: "A's strategy",
      },
    });
    await db.strategyChecklistItem.create({
      data: { strategyId: strategy.id, label: "HTF aligné", order: 0 },
    });

    expect(
      await db.strategy.findMany({ where: { userId: userB.id } })
    ).toHaveLength(0);
    expect(
      await db.strategy.findFirst({
        where: { id: strategy.id, userId: userB.id },
      })
    ).toBeNull();

    const updated = await db.strategy.updateMany({
      where: { id: strategy.id, userId: userB.id },
      data: { name: "HACKED" },
    });
    expect(updated.count).toBe(0);
    const fresh = await db.strategy.findUniqueOrThrow({ where: { id: strategy.id } });
    expect(fresh.name).toBe("Gold breakout");

    const deleted = await db.strategy.deleteMany({
      where: { id: strategy.id, userId: userB.id },
    });
    expect(deleted.count).toBe(0);
    expect(
      await db.strategy.findUnique({ where: { id: strategy.id } })
    ).not.toBeNull();

    const deletedA = await db.strategy.deleteMany({
      where: { id: strategy.id, userId: userA.id },
    });
    expect(deletedA.count).toBe(1);
    expect(
      await db.strategyChecklistItem.findFirst({
        where: { strategyId: strategy.id },
      })
    ).toBeNull();
  });
});

describe("trades, executions & screenshots", () => {
  let tradeAId: string;

  it("B cannot read, update or delete A's trade (scoped pattern)", async () => {
    const trade = await db.trade.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        instrumentId,
        direction: "LONG",
        status: "CLOSED",
        entryTime: new Date("2026-01-05T09:00:00Z"),
        exitTime: new Date("2026-01-05T13:00:00Z"),
        entryPrice: "2345.00",
        exitPrice: "2351.80",
        stopLoss: "2340.00",
        lots: "0.5",
        pips: "68",
        netPnl: "333",
        preTradeAnalysis: "",
        postTradeReview: "",
      },
    });
    tradeAId = trade.id;

    await db.tradeExecution.create({
      data: {
        tradeId: trade.id,
        type: "ENTRY",
        time: new Date("2026-01-05T09:00:00Z"),
        price: "2345.00",
        lots: "0.5",
      },
    });

    expect(
      await db.trade.findMany({ where: { userId: userB.id } })
    ).toHaveLength(0);
    expect(
      await db.trade.findFirst({ where: { id: tradeAId, userId: userB.id } })
    ).toBeNull();

    const upd = await db.trade.updateMany({
      where: { id: tradeAId, userId: userB.id },
      data: { netPnl: "999999" },
    });
    expect(upd.count).toBe(0);
    const fresh = await db.trade.findUniqueOrThrow({ where: { id: tradeAId } });
    expect(fresh.netPnl?.toString()).toBe("333");

    const del = await db.trade.deleteMany({
      where: { id: tradeAId, userId: userB.id },
    });
    expect(del.count).toBe(0);
    expect(await db.trade.findUnique({ where: { id: tradeAId } })).not.toBeNull();
  });

  it("B cannot read or delete A's screenshot (scoped pattern)", async () => {
    const shot = await db.tradeScreenshot.create({
      data: {
        tradeId: tradeAId,
        userId: userA.id,
        storagePath: `${userA.id}/${tradeAId}/chart.webp`,
        label: "ENTRY",
      },
    });

    expect(
      await db.tradeScreenshot.findMany({ where: { userId: userB.id } })
    ).toHaveLength(0);
    expect(
      await db.tradeScreenshot.findFirst({
        where: { id: shot.id, userId: userB.id },
      })
    ).toBeNull();
    const del = await db.tradeScreenshot.deleteMany({
      where: { id: shot.id, userId: userB.id },
    });
    expect(del.count).toBe(0);
    expect(
      await db.tradeScreenshot.findUnique({ where: { id: shot.id } })
    ).not.toBeNull();

    const delA = await db.tradeScreenshot.deleteMany({
      where: { id: shot.id, userId: userA.id },
    });
    expect(delA.count).toBe(1);
  });

  it("deleting A's trade cascades to executions", async () => {
    expect(
      await db.tradeExecution.findMany({ where: { tradeId: tradeAId } })
    ).toHaveLength(1);
    await db.trade.deleteMany({ where: { id: tradeAId, userId: userA.id } });
    expect(
      await db.tradeExecution.findMany({ where: { tradeId: tradeAId } })
    ).toHaveLength(0);
  });
});

describe("saved views (addendum §11.3)", () => {
  it("same (page, name) can coexist for different users; B never sees A's", async () => {
    await db.savedView.create({
      data: {
        userId: userA.id,
        page: "trades",
        name: "XAUUSD gagnants",
        filtersJson: "{}",
      },
    });
    await db.savedView.create({
      data: {
        userId: userB.id,
        page: "trades",
        name: "XAUUSD gagnants",
        filtersJson: "{}",
      },
    });
    expect(
      await db.savedView.findMany({ where: { userId: userA.id } })
    ).toHaveLength(1);
    expect(
      await db.savedView.findMany({ where: { userId: userB.id } })
    ).toHaveLength(1);
    const del = await db.savedView.deleteMany({
      where: { page: "trades", userId: userB.id },
    });
    expect(del.count).toBe(1);
    expect(
      await db.savedView.findMany({ where: { userId: userA.id } })
    ).toHaveLength(1);
    await db.savedView.deleteMany({ where: { userId: userA.id } });
  });
});
