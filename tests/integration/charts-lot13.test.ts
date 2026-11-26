/**
 * Lot 13 - Charts, market data and reports (roadmap §17).
 *
 * Server-side checks through the data-access layer:
 * - CSV candle import accounting (imported + skipped + invalid = rows),
 *   OHLC validation, out-of-order rows, DST-safe timezone conversion.
 * - Candle window truncation flag (6,000-bar cap is reported, not silent).
 * - Builder data flags a deleted account filter instead of silently
 *   falling back to all accounts.
 * - Monthly report: month boundaries in the profile timezone, currency
 *   exclusion, figures matching the underlying trades.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  getBuilderTrades,
  getCandleWindow,
  importCandles,
} from "@/server/charts";
import { getMonthlyReport } from "@/server/reports";

let user: { id: string };
let usdAccountId: string;
let eurAccountId: string;
let instrumentId: string;

const trade = (
  entryTime: Date,
  exitTime: Date,
  extra: { accountId: string; netPnl: string; pnlCurrency?: string; rMultiple?: string; resultType?: "WIN" | "LOSS" }
) => ({
  userId: user.id,
  accountId: extra.accountId,
  instrumentId,
  direction: "LONG" as const,
  status: "CLOSED" as const,
  session: "LONDON",
  entryTime,
  exitTime,
  entryPrice: "2000",
  exitPrice: "2010",
  lots: "1",
  netPnl: extra.netPnl,
  pnlCurrency: extra.pnlCurrency ?? "USD",
  rMultiple: extra.rMultiple ?? "1",
  resultType: extra.resultType ?? ("WIN" as const),
  followedPlan: true,
  riskPercent: "1",
  preTradeAnalysis: "",
  postTradeReview: "",
});

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "lot13-charts@test.local",
    password: "lot13-test-password",
    displayName: "Lot 13",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  user = created.user;
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  usdAccountId = accounts[0].id;
  const eur = await db.account.create({
    data: {
      userId: user.id,
      name: "EUR account",
      type: "DEMO",
      currency: "EUR",
      initialBalance: "10000",
    },
  });
  eurAccountId = eur.id;

  // User-owned instrument, unique to this file - no other test file
  // touches its candles.
  const instrument = await db.instrument.create({
    data: {
      userId: user.id,
      symbol: "LOT13",
      name: "Lot 13 test metal",
      assetClass: "METAL",
      baseCurrency: "XAU",
      quoteCurrency: "USD",
      digits: 2,
      pipSize: "0.10",
      pointSize: "0.01",
      contractSize: "100",
      tickSize: "0.01",
      isActive: true,
    },
  });
  instrumentId = instrument.id;

  await db.trade.createMany({
    data: [
      // Exits 2026-10-31 23:30 Toronto (2026-11-01 03:30 UTC) - October.
      trade(new Date("2026-10-31T14:00:00Z"), new Date("2026-11-01T03:30:00Z"), {
        accountId: usdAccountId,
        netPnl: "-10",
        rMultiple: "-0.1",
        resultType: "LOSS",
      }),
      // Exits 2026-11-01 00:30 Toronto (05:30 UTC) - November.
      trade(new Date("2026-10-31T20:00:00Z"), new Date("2026-11-01T05:30:00Z"), {
        accountId: usdAccountId,
        netPnl: "25",
        rMultiple: "0.25",
      }),
      trade(new Date("2026-11-10T14:00:00Z"), new Date("2026-11-10T15:00:00Z"), {
        accountId: usdAccountId,
        netPnl: "100",
      }),
      trade(new Date("2026-11-12T14:00:00Z"), new Date("2026-11-12T15:00:00Z"), {
        accountId: usdAccountId,
        netPnl: "-50",
        rMultiple: "-0.5",
        resultType: "LOSS",
      }),
      // EUR-denominated trade in November - excluded from the USD report.
      trade(new Date("2026-11-11T14:00:00Z"), new Date("2026-11-11T15:00:00Z"), {
        accountId: eurAccountId,
        netPnl: "200",
        pnlCurrency: "EUR",
      }),
    ],
  });
});

afterAll(async () => {
  // Deleting the user cascades to the instrument, its candles, the
  // accounts and the trades.
  await db.user.deleteMany({ where: { id: user.id } });
  await db.$disconnect();
});

describe("CSV candle import (lot 13)", () => {
  it("accounts every row: imported + skipped + invalid = rows in the file", async () => {
    const csv = [
      "time,open,high,low,close",
      "2026-11-20 10:00,100,101,99,100.5",
      "2026-11-20 10:15,100.5,102,100,101",
      "2026-11-20 10:30,101,103,100.5,102",
      "2026-11-20 10:00,100,101,99,100.5",
      "2026-11-20 10:45,100,99,101,100",
      "not a date,100,101,99,100",
      "2026-11-20 11:00,0,101,99,100",
    ].join("\n");
    const first = await importCandles(user.id, {
      instrumentId,
      timeframe: "M15",
      timezone: "UTC",
      csv,
    });
    expect(first.imported).toBe(3);
    expect(first.skipped).toBe(1); // the in-file duplicate
    expect(first.invalid).toBe(3); // high<low, unparseable time, zero open
    expect(first.imported + first.skipped + first.invalid).toBe(7);

    // Re-import: the 3 stored rows are duplicates now, invalid rows
    // are still invalid, the in-file duplicate is still a duplicate.
    const second = await importCandles(user.id, {
      instrumentId,
      timeframe: "M15",
      timezone: "UTC",
      csv,
    });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(4);
    expect(second.invalid).toBe(3);
  });

  it("rejects OHLC-inconsistent rows instead of storing them", async () => {
    const csv = [
      "time,open,high,low,close",
      "2026-11-20 12:00,100,99,101,100",
      "2026-11-20 12:15,100,101,99,100.5",
    ].join("\n");
    const res = await importCandles(user.id, {
      instrumentId,
      timeframe: "M15",
      timezone: "UTC",
      csv,
    });
    expect(res.imported).toBe(1);
    expect(res.invalid).toBe(1);
    const window = await getCandleWindow(user.id, {
      instrumentId,
      timeframe: "M15",
      from: "2026-11-20T12:00:00.000Z",
      to: "2026-11-20T13:00:00.000Z",
    });
    expect(window.candles).toHaveLength(1);
    expect(window.candles[0].close).toBe("100.5");
  });

  it("accepts out-of-order rows and serves them chronologically", async () => {
    const csv = [
      "time,open,high,low,close",
      "2026-11-21 11:00,102,103,101,102.5",
      "2026-11-21 09:00,100,101,99,100.5",
      "2026-11-21 10:00,100.5,102,100,101",
    ].join("\n");
    const res = await importCandles(user.id, {
      instrumentId,
      timeframe: "H1",
      timezone: "UTC",
      csv,
    });
    expect(res.imported).toBe(3);
    const window = await getCandleWindow(user.id, {
      instrumentId,
      timeframe: "H1",
      from: "2026-11-21T09:00:00.000Z",
      to: "2026-11-21T12:00:00.000Z",
    });
    const times = window.candles.map((c) => c.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(window.candles[0].open).toBe("100");
  });

  it("converts declared-timezone wall times across the DST jump", async () => {
    const csv = [
      "time,open,high,low,close",
      "2026-03-08 03:30,100,101,99,100.5",
      "2026-03-08 04:30,100.5,102,100,101",
    ].join("\n");
    const res = await importCandles(user.id, {
      instrumentId,
      timeframe: "H1",
      timezone: "America/Toronto",
      csv,
    });
    expect(res.imported).toBe(2);
    const window = await getCandleWindow(user.id, {
      instrumentId,
      timeframe: "H1",
      from: "2026-03-08T07:00:00.000Z",
      to: "2026-03-08T09:00:00.000Z",
    });
    expect(window.candles.map((c) => c.time)).toEqual([
      Math.floor(Date.UTC(2026, 2, 8, 7, 30) / 1000),
      Math.floor(Date.UTC(2026, 2, 8, 8, 30) / 1000),
    ]);
  });
});

describe("candle window truncation (lot 13)", () => {
  it("reports truncated=true past the 6,000-bar cap and keeps the newest bars", async () => {
    const start = Date.UTC(2026, 10, 20, 0, 0, 0);
    const rows = Array.from({ length: 6001 }, (_, i) => ({
      instrumentId,
      timeframe: "M1",
      openTime: new Date(start + i * 60_000),
      open: "100",
      high: "101",
      low: "99",
      close: "100.5",
      volume: null,
    }));
    await db.priceCandle.createMany({ data: rows });
    const window = await getCandleWindow(user.id, {
      instrumentId,
      timeframe: "M1",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-25T00:00:00.000Z",
    });
    expect(window.truncated).toBe(true);
    expect(window.candles).toHaveLength(6000);
    // The oldest bar was cut: the first returned bar is the second one.
    expect(window.candles[0].time).toBe(Math.floor((start + 60_000) / 1000));
  });

  it("reports truncated=false for a small window", async () => {
    const window = await getCandleWindow(user.id, {
      instrumentId,
      timeframe: "M1",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-20T00:10:00.000Z",
    });
    expect(window.truncated).toBe(false);
    expect(window.candles.length).toBeGreaterThan(0);
    expect(window.candles.length).toBeLessThanOrEqual(11);
  });
});

describe("builder data account filter (lot 13)", () => {
  it("flags a deleted account filter instead of silently showing all accounts", async () => {
    const missing = await getBuilderTrades(user.id, {
      period: "all",
      account: "does-not-exist",
    });
    expect(missing.accountMissing).toBe(true);
    expect(missing.trades).toHaveLength(5); // fallback covers all accounts

    const known = await getBuilderTrades(user.id, {
      period: "all",
      account: usdAccountId,
    });
    expect(known.accountMissing).toBe(false);
    expect(known.trades).toHaveLength(4);

    const all = await getBuilderTrades(user.id, { period: "all" });
    expect(all.accountMissing).toBe(false);
    expect(all.trades).toHaveLength(5);
  });
});

describe("monthly report coherence (lot 13)", () => {
  it("uses Toronto month boundaries, excludes the EUR trade, and matches the trades", async () => {
    const report = await getMonthlyReport(user.id, "2026-11");
    expect(report).not.toBeNull();
    expect(report!.currency).toBe("USD");
    expect(report!.tradeCount).toBe(3);
    expect(report!.excludedTradeCount).toBe(1);
    expect(report!.netPnl).toBe("75");
    expect(report!.bestTrades[0].netPnl).toBe("100");
    expect(report!.worstTrades[0].netPnl).toBe("-50");
    // Cumulative P&L series: chronological, one point per included trade.
    expect(report!.equity.map((p) => p.cumPnl)).toEqual(["25", "125", "75"]);
    expect(report!.bySymbol).toHaveLength(1);
    expect(report!.bySymbol[0].name).toBe("LOT13");
    expect(report!.bySymbol[0].trades).toBe(3);

    const october = await getMonthlyReport(user.id, "2026-10");
    expect(october!.tradeCount).toBe(1);
    expect(october!.netPnl).toBe("-10");
  });

  it("returns null for an unknown account filter", async () => {
    expect(await getMonthlyReport(user.id, "2026-11", "does-not-exist")).toBeNull();
  });
});
