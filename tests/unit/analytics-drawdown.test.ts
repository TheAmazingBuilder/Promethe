/**
 * Unit tests — analytics drawdown semantics.
 *
 * Distinguishes cumulative trade-P&L drawdown from account-equity drawdown
 * and verifies that the maximum percentage is not tied to the max cash DD.
 */
import { describe, expect, it } from "vitest";
import {
  computeEquityCurve,
  computeTradeStats,
  type StatTrade,
} from "@/lib/analytics/engine";

function trade(id: string, netPnl: string, exitTime: string): StatTrade {
  return {
    id,
    exitTime,
    entryTime: exitTime,
    netPnl,
    rMultiple: null,
    resultType: null,
    strategyId: null,
    instrumentId: "i1",
    symbol: "XAUUSD",
    direction: "LONG",
    session: null,
    lots: "1",
  };
}

describe("analytics drawdown", () => {
  const trades = [
    trade("t1", "-100", "2026-01-01T10:00:00.000Z"),
    trade("t2", "150", "2026-01-02T10:00:00.000Z"),
    trade("t3", "-80", "2026-01-03T10:00:00.000Z"),
  ];

  it("keeps cumulative P&L drawdown distinct from account equity drawdown", () => {
    const stats = computeTradeStats(trades);
    const curve = computeEquityCurve(trades, "1000");

    // Cumulative P&L: 0 → -100 → 50 → -30; max peak-to-trough = 100.
    expect(stats.maxDrawdown).toBe("100");
    // Equity: 1000 → 900 → 1050 → 970; max peak-to-trough = 80.
    expect(curve.map((point) => point.drawdown)).toEqual(["100", "0", "80"]);
  });

  it("tracks maximum percentage drawdown independently of maximum cash drawdown", () => {
    const stats = computeTradeStats(trades);

    // The 100 cash drawdown occurs from a zero peak (no meaningful %).
    // A later 80 drawdown from a 50 peak is a meaningful 160%.
    expect(stats.maxDrawdownPercent).toBe("160");
  });
});
