/**
 * Unit tests — trades "By day" grouping (MRT wave 2, src/lib/trades/by-day.ts).
 * Pure logic only: no DOM, no network, no database.
 */
import { describe, expect, it } from "vitest";
import { groupTradesByDay } from "@/lib/trades/by-day";
import type { TradeListItemDTO } from "@/lib/trading/dto";

function trade(partial: Partial<TradeListItemDTO>): TradeListItemDTO {
  return {
    id: "trade-1",
    accountId: "acc-1",
    accountName: "Live Account",
    strategyId: null,
    strategyName: null,
    instrumentId: "ins-xauusd",
    symbol: "XAUUSD",
    digits: 2,
    direction: "LONG",
    orderType: "MARKET",
    status: "CLOSED",
    timeframe: "M15",
    session: "NEW_YORK",
    setupType: null,
    setupId: null,
    strategyVersion: null,
    entryTime: "2026-11-17T14:00:00.000Z",
    exitTime: "2026-11-17T16:00:00.000Z",
    entryPrice: "2345.00",
    exitPrice: "2351.80",
    stopLoss: null,
    takeProfit: null,
    lots: "0.5",
    riskPercent: null,
    pips: "68",
    netPnl: "100",
    pnlCurrency: "USD",
    rMultiple: "1",
    plannedRR: null,
    resultType: "WIN",
    exitReason: null,
    reviewStatus: "REVIEWED",
    isDraft: false,
    emotionBefore: null,
    followedPlan: null,
    createdAt: "2026-11-17T16:00:00.000Z",
    updatedAt: "2026-11-17T16:00:00.000Z",
    tags: [],
    customFields: null,
    currentPrice: null,
    ...partial,
  } as TradeListItemDTO;
}

describe("groupTradesByDay", () => {
  it("returns no groups for an empty list", () => {
    expect(groupTradesByDay([], "UTC")).toEqual([]);
  });

  it("groups by entry day, newest day first", () => {
    const groups = groupTradesByDay(
      [
        trade({ id: "t1", entryTime: "2026-11-16T10:00:00.000Z" }),
        trade({ id: "t2", entryTime: "2026-11-17T10:00:00.000Z" }),
        trade({ id: "t3", entryTime: "2026-11-17T15:00:00.000Z" }),
      ],
      "UTC"
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-11-17", "2026-11-16"]);
    expect(groups[0].trades.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(groups[1].trades.map((t) => t.id)).toEqual(["t1"]);
  });

  it("sums the day P&L and counts wins and losses per group", () => {
    const groups = groupTradesByDay(
      [
        trade({ id: "t1", netPnl: "120", resultType: "WIN" }),
        trade({ id: "t2", netPnl: "-40", resultType: "LOSS" }),
        trade({ id: "t3", netPnl: "0", resultType: "BREAKEVEN" }),
      ],
      "UTC"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].netPnl).toBe("80");
    expect(groups[0].wins).toBe(1);
    expect(groups[0].losses).toBe(1);
    expect(groups[0].currency).toBe("USD");
  });

  it("uses the user timezone for the entry day, not UTC", () => {
    // 01:30 UTC is 20:30 the previous day in Toronto (EST, UTC-5).
    const groups = groupTradesByDay(
      [trade({ id: "t1", entryTime: "2026-11-17T01:30:00.000Z" })],
      "America/Toronto"
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-11-16");
    const utc = groupTradesByDay(
      [trade({ id: "t1", entryTime: "2026-11-17T01:30:00.000Z" })],
      "UTC"
    );
    expect(utc[0].date).toBe("2026-11-17");
  });

  it("treats a null P&L as zero and picks the most frequent currency", () => {
    const groups = groupTradesByDay(
      [
        trade({ id: "t1", netPnl: null, pnlCurrency: "EUR" }),
        trade({ id: "t2", netPnl: "50", pnlCurrency: "USD" }),
        trade({ id: "t3", netPnl: "25", pnlCurrency: "USD" }),
      ],
      "UTC"
    );
    expect(groups[0].netPnl).toBe("75");
    expect(groups[0].currency).toBe("USD");
  });
});
