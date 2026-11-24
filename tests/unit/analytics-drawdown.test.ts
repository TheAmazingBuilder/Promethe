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

  it("is blind to deposits and withdrawals: they are not inputs", () => {
    // A 500 deposit between t1 and t2 would change a true equity
    // drawdown, but computeTradeStats only ever sees closed trades —
    // there is no cash-flow parameter. The stat must therefore be
    // labelled "Max P&L drawdown", never equity drawdown (MD §3.4).
    // Even shifting the starting balance only moves the curve level:
    // peak-to-trough is unchanged.
    const stats = computeTradeStats(trades);
    expect(stats.maxDrawdown).toBe("100");
    const curve1000 = computeEquityCurve(trades, "1000");
    const curve1500 = computeEquityCurve(trades, "1500");
    expect(curve1000.map((p) => p.drawdown)).toEqual(["100", "0", "80"]);
    expect(curve1500.map((p) => p.drawdown)).toEqual(["100", "0", "80"]);
    expect(curve1500.map((p) => p.equity)).toEqual(["1400", "1550", "1470"]);
  });

  it("handles initialBalance 0: the curve starts at 0 and tracks cumulative P&L", () => {
    const curve = computeEquityCurve(trades, "0");
    expect(curve.map((p) => p.equity)).toEqual(["-100", "50", "-30"]);
    expect(curve.map((p) => p.drawdown)).toEqual(["100", "0", "80"]);
  });

  it("returns a null maxDrawdownPercent when cumulative P&L never peaks above 0", () => {
    const losing = [
      trade("t1", "-100", "2026-01-01T10:00:00.000Z"),
      trade("t2", "-80", "2026-01-02T10:00:00.000Z"),
    ];
    const stats = computeTradeStats(losing);
    expect(stats.maxDrawdown).toBe("180");
    expect(stats.maxDrawdownPercent).toBeNull();
    // Same with a zero starting balance: no positive peak, no %.
    const curve = computeEquityCurve(losing, "0");
    expect(curve.map((p) => p.equity)).toEqual(["-100", "-180"]);
  });

  it("returns empty states with no closed trades", () => {
    const stats = computeTradeStats([]);
    expect(stats.tradeCount).toBe(0);
    expect(stats.maxDrawdown).toBe("0");
    expect(stats.maxDrawdownPercent).toBeNull();
    expect(computeEquityCurve([], "1000")).toEqual([]);
  });

  it("excludes open positions only because callers filter them out", () => {
    // The engine computes over exactly the list it is given: it cannot
    // tell an open trade from a closed one (StatTrade carries no
    // status). An unfiltered open trade WOULD be counted — so the
    // exclusion lives in the server callers (getAnalytics,
    // dashboard-data, reports all filter status CLOSED). This pins the
    // contract: pass closed trades only.
    const openShaped = trade("open", "0", "2026-01-04T10:00:00.000Z");
    expect(computeTradeStats([...trades, openShaped]).tradeCount).toBe(4);
    expect(computeTradeStats(trades).tradeCount).toBe(3);
  });
});
