/**
 * §20 - Global search: permissions, pagination and honest totals.
 *
 * Proves against PostgreSQL schema promethe_test:
 *  1. Totals count every match, not just the returned page.
 *  2. Offset pages through the matches in stable (recency) order.
 *  3. Isolation - another user's rows never appear, even with the
 *     same search terms.
 *  4. Empty states - an empty query and a query with no match both
 *     return all-zero payloads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { globalSearch } from "@/server/search";

let userA: { id: string; email: string };
let userB: { id: string; email: string };
let accountAId: string;
let accountBId: string;
let instrumentId: string;
// User A's three matching trades, newest first (1, 2, 3 days ago).
let tradeA1: { id: string };
let tradeA2: { id: string };
let tradeA3: { id: string };

const now = Date.now();

async function makeTrade(
  userId: string,
  accountId: string,
  entryDaysAgo: number,
  searchText: string
) {
  return db.trade.create({
    data: {
      userId,
      accountId,
      instrumentId,
      direction: "LONG",
      orderType: "MARKET",
      status: "CLOSED",
      entryTime: new Date(now - entryDaysAgo * 86_400_000),
      exitTime: new Date(now - entryDaysAgo * 86_400_000 + 3_600_000),
      entryPrice: "2300.00",
      exitPrice: "2310.00",
      lots: "1",
      netPnl: "100",
      resultType: "WIN",
      pnlSource: "CALCULATED",
      pnlCurrency: "USD",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
      notes: searchText,
      searchText,
    },
  });
}

beforeAll(async () => {
  const instrument = await db.instrument.create({
    data: {
      userId: null,
      symbol: "XAUUSD-SEARCH-TEST",
      name: "Gold test",
      assetClass: "METAL",
      quoteCurrency: "USD",
      digits: 2,
      pipSize: "0.10",
      pointSize: "0.01",
      contractSize: "100",
    },
  });
  instrumentId = instrument.id;

  const a = await createUserWithDefaults({
    email: "search-a@test.local",
    password: "password1",
    displayName: "Search A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "search-b@test.local",
    password: "password1",
    displayName: "Search B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  accountAId = (
    await db.account.findFirstOrThrow({ where: { userId: userA.id } })
  ).id;
  accountBId = (
    await db.account.findFirstOrThrow({ where: { userId: userB.id } })
  ).id;

  // User A: 3 matching trades (distinct entry times for stable order),
  // 1 matching strategy, 1 matching journal entry.
  tradeA1 = await makeTrade(userA.id, accountAId, 1, "london session gold");
  tradeA2 = await makeTrade(userA.id, accountAId, 2, "london session gold");
  tradeA3 = await makeTrade(userA.id, accountAId, 3, "london session gold");
  await db.strategy.create({
    data: { userId: userA.id, name: "London breakout", searchText: "london breakout" },
  });
  await db.journalEntry.create({
    data: {
      userId: userA.id,
      date: "2031-06-01",
      preMarketPlan: "London open",
      searchText: "london open",
    },
  });

  // User B: same terms, must never leak into A's results.
  await makeTrade(userB.id, accountBId, 1, "london session gold");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

describe("global search totals and pagination", () => {
  it("returns real totals and pages the rows", async () => {
    const page1 = await globalSearch(userA.id, "london", 2);
    expect(page1.totalTrades).toBe(3);
    expect(page1.totalStrategies).toBe(1);
    expect(page1.totalJournal).toBe(1);
    expect(page1.total).toBe(5);
    expect(page1.trades).toHaveLength(2);
    expect(page1.strategies).toHaveLength(1);
    expect(page1.journal).toHaveLength(1);

    // Most recent first, offset pages through the rest.
    expect(page1.trades.map((t) => t.id)).toEqual([tradeA1.id, tradeA2.id]);
    const page2 = await globalSearch(userA.id, "london", 2, 2);
    expect(page2.totalTrades).toBe(3);
    expect(page2.total).toBe(5);
    expect(page2.trades.map((t) => t.id)).toEqual([tradeA3.id]);

    const page3 = await globalSearch(userA.id, "london", 2, 4);
    expect(page3.trades).toHaveLength(0);
    expect(page3.totalTrades).toBe(3);
  });

  it("never returns another user's rows", async () => {
    const result = await globalSearch(userB.id, "london", 10);
    expect(result.totalTrades).toBe(1);
    expect(result.totalStrategies).toBe(0);
    expect(result.totalJournal).toBe(0);
    expect(result.total).toBe(1);
  });

  it("returns all-zero payloads for empty and unmatched queries", async () => {
    const empty = await globalSearch(userA.id, "   ", 10);
    expect(empty).toEqual({
      query: "   ",
      trades: [],
      strategies: [],
      journal: [],
      total: 0,
      totalTrades: 0,
      totalStrategies: 0,
      totalJournal: 0,
    });
    const nomatch = await globalSearch(userA.id, "zzz-no-such-term", 10);
    expect(nomatch.total).toBe(0);
    expect(nomatch.totalTrades).toBe(0);
    expect(nomatch.trades).toHaveLength(0);
  });
});
