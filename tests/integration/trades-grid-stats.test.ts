/**
 * Phase 2 perf item 7 — trades grid: aggregated stats + batched candles
 * (db/test.db).
 *
 * getGridStats aggregates in SQL (same numbers as computeGridStats over
 * the same rows); getCandleBatch serves every card window from one
 * union fetch per (instrument, timeframe) group, falling back to
 * per-window fetches when the union would exceed the 6000-bar cap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { getGridStats } from "@/server/trades";
import { getCandleBatch } from "@/server/charts";
import { candleWindowForTrade } from "@/lib/trades/grid-stats";
import type { TradeListQuery } from "@/lib/validations/trade";

const BASE_QUERY: TradeListQuery = {
  page: 1,
  pageSize: 25,
  includeDrafts: false,
  sort: "entryTime",
  order: "desc",
};

function instrumentSpec(symbol: string, base: string, quote: string) {
  return {
    symbol,
    name: `${base} / ${quote}`,
    assetClass: "METAL",
    baseCurrency: base,
    quoteCurrency: quote,
    digits: 2,
    pipSize: "0.10",
    pointSize: "0.01",
    contractSize: "100",
    tickSize: "0.01",
    isActive: true,
  };
}

let user: { id: string };
let xauusdId: string;
let eurusdId: string;
let accountId: string;

beforeAll(async () => {
  const findOrCreate = async (symbol: string, base: string, quote: string) => {
    const existing = await db.instrument.findFirst({
      where: { userId: null, symbol },
    });
    if (existing) return existing;
    return db.instrument.create({
      data: { userId: null, ...instrumentSpec(symbol, base, quote) },
    });
  };
  const xauusd = await findOrCreate("XAUUSD", "XAU", "USD");
  xauusdId = xauusd.id;
  const eurusd = await findOrCreate("EURUSD", "EUR", "USD");
  eurusdId = eurusd.id;

  const created = await createUserWithDefaults({
    email: "grid-stats@test.local",
    password: "test-password-123",
    displayName: "Grid Stats Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  user = created.user;
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  accountId = accounts[0].id;

  // 14:00 UTC = 09:00 Toronto (EST, November); 15:00 UTC = 10:00.
  const trade = (
    entryTime: Date,
    exitTime: Date | null,
    extra: {
      exitPrice?: string | null;
      netPnl?: string | null;
      pnlCurrency?: string;
      rMultiple?: string | null;
      resultType?: "WIN" | "LOSS" | "BREAKEVEN" | null;
      status?: "OPEN" | "CLOSED";
    }
  ) => ({
    userId: user.id,
    accountId,
    instrumentId: xauusdId,
    direction: "LONG" as const,
    status: extra.status ?? ("CLOSED" as const),
    session: "LONDON",
    entryTime,
    exitTime,
    entryPrice: "2000",
    exitPrice: extra.exitPrice ?? null,
    lots: "1",
    netPnl: extra.netPnl ?? null,
    pnlCurrency: extra.pnlCurrency ?? "USD",
    rMultiple: extra.rMultiple ?? null,
    resultType: extra.resultType ?? null,
    followedPlan: true,
    riskPercent: "1",
    preTradeAnalysis: "",
    postTradeReview: "",
  });
  await db.trade.createMany({
    data: [
      trade(
        new Date(Date.UTC(2026, 10, 12, 14, 0, 0)),
        new Date(Date.UTC(2026, 10, 12, 16, 0, 0)),
        { exitPrice: "2010", netPnl: "100", rMultiple: "1", resultType: "WIN" }
      ),
      trade(
        new Date(Date.UTC(2026, 10, 12, 14, 0, 0)),
        new Date(Date.UTC(2026, 10, 12, 16, 0, 0)),
        { exitPrice: "2005", netPnl: "50", rMultiple: "0.5", resultType: "WIN" }
      ),
      trade(
        new Date(Date.UTC(2026, 10, 13, 15, 0, 0)),
        new Date(Date.UTC(2026, 10, 13, 17, 0, 0)),
        {
          exitPrice: "2002",
          netPnl: "20",
          pnlCurrency: "EUR",
          rMultiple: "0.2",
          resultType: "WIN",
        }
      ),
      trade(
        new Date(Date.UTC(2026, 10, 12, 14, 0, 0)),
        new Date(Date.UTC(2026, 10, 12, 16, 0, 0)),
        { exitPrice: "1997", netPnl: "-30", rMultiple: "-0.3", resultType: "LOSS" }
      ),
      trade(
        new Date(Date.UTC(2026, 10, 13, 14, 0, 0)),
        new Date(Date.UTC(2026, 10, 13, 16, 0, 0)),
        {
          exitPrice: "1999",
          netPnl: "-10",
          pnlCurrency: "EUR",
          rMultiple: "-0.1",
          resultType: "LOSS",
        }
      ),
      trade(
        new Date(Date.UTC(2026, 10, 12, 14, 0, 0)),
        new Date(Date.UTC(2026, 10, 12, 16, 0, 0)),
        { exitPrice: "2000", netPnl: "0", rMultiple: "0", resultType: "BREAKEVEN" }
      ),
      trade(new Date(Date.UTC(2026, 10, 12, 14, 0, 0)), null, {
        status: "OPEN",
      }),
    ],
  });

  // H1 candles for XAUUSD, Nov 12 00:00 → Nov 13 23:00 (48 bars).
  const h1: Array<{
    instrumentId: string;
    timeframe: string;
    openTime: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: null;
  }> = [];
  for (let i = 0; i < 48; i++) {
    const openTime = new Date(Date.UTC(2026, 10, 12, 0, 0, 0) + i * 3_600_000);
    h1.push({
      instrumentId: xauusdId,
      timeframe: "H1",
      openTime,
      open: String(2000 + i),
      high: String(2001 + i),
      low: String(1999 + i),
      close: String(2000.5 + i),
      volume: null,
    });
  }
  // Idempotent seed: clear this instrument's window first (re-runs share
  // the same test DB; candles have no user to cascade from).
  await db.priceCandle.deleteMany({
    where: {
      instrumentId: xauusdId,
      timeframe: "H1",
      openTime: {
        gte: new Date(Date.UTC(2026, 10, 12, 0, 0, 0)),
        lt: new Date(Date.UTC(2026, 10, 14, 0, 0, 0)),
      },
    },
  });
  await db.priceCandle.createMany({ data: h1 });

  // M1 candles for EURUSD, Nov 10 00:00 → Nov 14 23:59 (7200 bars) —
  // enough that any 5-day union exceeds the 6000-bar cap.
  const m1: Array<{
    instrumentId: string;
    timeframe: string;
    openTime: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: null;
  }> = [];
  for (let i = 0; i < 7200; i++) {
    const openTime = new Date(Date.UTC(2026, 10, 10, 0, 0, 0) + i * 60_000);
    m1.push({
      instrumentId: eurusdId,
      timeframe: "M1",
      openTime,
      open: "1.1000",
      high: "1.1001",
      low: "1.0999",
      close: "1.1000",
      volume: null,
    });
  }
  await db.priceCandle.deleteMany({
    where: {
      instrumentId: eurusdId,
      timeframe: "M1",
      openTime: {
        gte: new Date(Date.UTC(2026, 10, 10, 0, 0, 0)),
        lt: new Date(Date.UTC(2026, 10, 15, 0, 0, 0)),
      },
    },
  });
  await db.priceCandle.createMany({ data: m1 });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [user.id] } } });
  await db.$disconnect();
});

describe("getGridStats", () => {
  it("aggregates the whole filtered set", async () => {
    const stats = await getGridStats(user.id, BASE_QUERY);
    expect(stats).toEqual({
      count: 7,
      wins: 3,
      losses: 2,
      breakevens: 1,
      winRate: 60,
      netPnl: "130",
      currency: "USD",
    });
  });

  it("respects list filters (resultType)", async () => {
    const stats = await getGridStats(user.id, {
      ...BASE_QUERY,
      resultType: "WIN",
    });
    expect(stats.count).toBe(3);
    expect(stats.wins).toBe(3);
    expect(stats.netPnl).toBe("170");
    expect(stats.currency).toBe("USD");
  });

  it("drill-down entryHour filters in the user's timezone", async () => {
    const at9 = await getGridStats(user.id, { ...BASE_QUERY, entryHour: 9 });
    expect(at9.count).toBe(6);
    expect(at9.wins).toBe(2);
    expect(at9.netPnl).toBe("110");
    const at10 = await getGridStats(user.id, { ...BASE_QUERY, entryHour: 10 });
    expect(at10).toEqual({
      count: 1,
      wins: 1,
      losses: 0,
      breakevens: 0,
      winRate: 100,
      netPnl: "20",
      currency: "EUR",
    });
  });

  it("empty set: zero count, no win rate, zero P&L", async () => {
    const stats = await getGridStats(user.id, {
      ...BASE_QUERY,
      search: "zzz-no-match",
    });
    expect(stats).toEqual({
      count: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: null,
      netPnl: "0",
      currency: "USD",
    });
  });
});

describe("getCandleBatch", () => {
  it("serves two same-group windows from one union fetch, sliced", async () => {
    const w1 = candleWindowForTrade(
      new Date(Date.UTC(2026, 10, 12, 14, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 10, 12, 16, 0, 0)).toISOString(),
      "H1"
    );
    const w2 = candleWindowForTrade(
      new Date(Date.UTC(2026, 10, 13, 14, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 10, 13, 16, 0, 0)).toISOString(),
      "H1"
    );
    const results = await getCandleBatch(user.id, [
      { instrumentId: xauusdId, ...w1 },
      { instrumentId: xauusdId, ...w2 },
    ]);
    expect(results).toHaveLength(2);
    // w1 window [Nov 11 14:00, Nov 12 22:00] ∩ stored H1 = 23 bars.
    expect(results[0].candles).toHaveLength(23);
    // w2 window [Nov 12 14:00, Nov 13 22:00] = 33 bars.
    expect(results[1].candles).toHaveLength(33);
    for (const [i, w] of [w1, w2].entries()) {
      const fromSec = Date.parse(w.from) / 1000;
      const toSec = Date.parse(w.to) / 1000;
      for (const c of results[i].candles) {
        expect(c.time).toBeGreaterThanOrEqual(fromSec);
        expect(c.time).toBeLessThanOrEqual(toSec);
      }
    }
  });

  it("falls back to per-window fetches when the union exceeds the cap", async () => {
    const w1 = candleWindowForTrade(
      new Date(Date.UTC(2026, 10, 10, 12, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 10, 10, 14, 0, 0)).toISOString(),
      "H1"
    );
    const w2 = candleWindowForTrade(
      new Date(Date.UTC(2026, 10, 14, 12, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 10, 14, 14, 0, 0)).toISOString(),
      "H1"
    );
    const results = await getCandleBatch(user.id, [
      { instrumentId: eurusdId, ...w1 },
      { instrumentId: eurusdId, ...w2 },
    ]);
    // Union spans 5+ days of M1 (> 6000 bars) so it is capped; each
    // card's own window is served whole instead: 1201 and 1921 bars.
    expect(results[0].candles).toHaveLength(1201);
    expect(results[1].candles).toHaveLength(1921);
  });

  it("an unknown instrument yields empty candles, not a failed batch", async () => {
    const w = candleWindowForTrade(
      new Date(Date.UTC(2026, 10, 12, 14, 0, 0)).toISOString(),
      new Date(Date.UTC(2026, 10, 12, 16, 0, 0)).toISOString(),
      "H1"
    );
    const results = await getCandleBatch(user.id, [
      { instrumentId: xauusdId, ...w },
      { instrumentId: "does-not-exist", ...w },
    ]);
    expect(results[0].candles.length).toBeGreaterThan(0);
    expect(results[1]).toEqual({ candles: [] });
  });
});
