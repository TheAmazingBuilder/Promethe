/**
 * Unit tests — trades grid view helpers (src/lib/trades/grid-stats.ts).
 * Pure logic only: no DOM, no network, no database.
 */
import { describe, expect, it } from "vitest";
import {
  candleWindowForTrade,
  computeGridStats,
  layoutCandles,
  parseGridViewMode,
  readGridViewMode,
  resolveCandleTimeframe,
  writeGridViewMode,
  type GridStatTrade,
} from "@/lib/trades/grid-stats";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function statTrade(
  partial: Partial<GridStatTrade> & { resultType: GridStatTrade["resultType"] }
): GridStatTrade {
  return { netPnl: null, pnlCurrency: "USD", ...partial };
}

describe("parseGridViewMode", () => {
  it("keeps grid", () => expect(parseGridViewMode("grid")).toBe("grid"));
  it("keeps table", () => expect(parseGridViewMode("table")).toBe("table"));
  it("keeps by-day", () => expect(parseGridViewMode("by-day")).toBe("by-day"));
  it("defaults unknown values to table", () => {
    expect(parseGridViewMode(undefined)).toBe("table");
    expect(parseGridViewMode(null)).toBe("table");
    expect(parseGridViewMode("cards")).toBe("table");
    expect(parseGridViewMode("")).toBe("table");
  });
});

describe("readGridViewMode / writeGridViewMode", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    expect(readGridViewMode(storage)).toBe("table");
    writeGridViewMode("grid", storage);
    expect(readGridViewMode(storage)).toBe("grid");
    writeGridViewMode("by-day", storage);
    expect(readGridViewMode(storage)).toBe("by-day");
    writeGridViewMode("table", storage);
    expect(readGridViewMode(storage)).toBe("table");
  });
  it("falls back to table on a broken storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readGridViewMode(broken)).toBe("table");
    expect(() => writeGridViewMode("grid", broken)).not.toThrow();
  });
  it("falls back to table on a stale stored value", () => {
    expect(readGridViewMode(fakeStorage({ "promethe.trades.viewMode": "cards" }))).toBe(
      "table"
    );
  });
});

describe("computeGridStats", () => {
  it("empty set: zero count, no win rate, zero P&L", () => {
    expect(computeGridStats([])).toEqual({
      count: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: null,
      netPnl: "0",
      currency: "USD",
    });
  });
  it("counts wins/losses/breakevens and sums P&L", () => {
    const stats = computeGridStats([
      statTrade({ resultType: "WIN", netPnl: "341" }),
      statTrade({ resultType: "WIN", netPnl: "412" }),
      statTrade({ resultType: "LOSS", netPnl: "-118" }),
      statTrade({ resultType: "BREAKEVEN", netPnl: "0" }),
      statTrade({ resultType: null, netPnl: null }),
    ]);
    expect(stats.count).toBe(5);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.breakevens).toBe(1);
    // 2 wins / 3 decided trades = 66.7% (breakeven + open excluded).
    expect(stats.winRate).toBe(66.7);
    expect(stats.netPnl).toBe("635");
  });
  it("win rate is null with no decided trade", () => {
    const stats = computeGridStats([
      statTrade({ resultType: "BREAKEVEN", netPnl: "0" }),
      statTrade({ resultType: null, netPnl: "12.5" }),
    ]);
    expect(stats.winRate).toBeNull();
    expect(stats.netPnl).toBe("12.5");
  });
  it("picks the most frequent currency", () => {
    const stats = computeGridStats([
      statTrade({ resultType: "WIN", netPnl: "10", pnlCurrency: "EUR" }),
      statTrade({ resultType: "WIN", netPnl: "10", pnlCurrency: "EUR" }),
      statTrade({ resultType: "LOSS", netPnl: "-5", pnlCurrency: "USD" }),
    ]);
    expect(stats.currency).toBe("EUR");
  });
  it("sums negative P&L and decimals exactly", () => {
    const stats = computeGridStats([
      statTrade({ resultType: "LOSS", netPnl: "-118.25" }),
      statTrade({ resultType: "LOSS", netPnl: "-0.75" }),
    ]);
    expect(stats.netPnl).toBe("-119");
    expect(stats.winRate).toBe(0);
  });
});

describe("resolveCandleTimeframe", () => {
  it("keeps M1-D1 timeframes", () => {
    expect(resolveCandleTimeframe("M15")).toBe("M15");
    expect(resolveCandleTimeframe("H4")).toBe("H4");
    expect(resolveCandleTimeframe("D1")).toBe("D1");
  });
  it("falls back to H1 for W1/MN and missing values", () => {
    expect(resolveCandleTimeframe("W1")).toBe("H1");
    expect(resolveCandleTimeframe("MN")).toBe("H1");
    expect(resolveCandleTimeframe(null)).toBe("H1");
    expect(resolveCandleTimeframe(undefined)).toBe("H1");
  });
});

describe("candleWindowForTrade", () => {
  it("M15: 24 bars before entry, 6 bars after exit", () => {
    const w = candleWindowForTrade(
      "2026-07-30T14:00:00.000Z",
      "2026-07-30T16:00:00.000Z",
      "M15"
    );
    expect(w.timeframe).toBe("M15");
    expect(w.from).toBe("2026-07-30T08:00:00.000Z");
    expect(w.to).toBe("2026-07-30T17:30:00.000Z");
  });
  it("open trade: window ends 6 bars after entry", () => {
    const w = candleWindowForTrade("2026-07-30T14:00:00.000Z", null, "H1");
    expect(w.timeframe).toBe("H1");
    expect(w.from).toBe("2026-07-29T14:00:00.000Z");
    expect(w.to).toBe("2026-07-30T20:00:00.000Z");
  });
});

describe("layoutCandles", () => {
  const up = { open: "10", high: "12", low: "9", close: "11" };
  const down = { open: "11", high: "12", low: "8", close: "9" };

  it("returns null for an empty list", () => {
    expect(layoutCandles([], 280, 104)).toBeNull();
  });
  it("returns null for flat prices (no range to draw)", () => {
    expect(
      layoutCandles(
        [{ open: "10", high: "10", low: "10", close: "10" }],
        280,
        104
      )
    ).toBeNull();
  });
  it("classifies up and down candles and stays inside the box", () => {
    const laid = layoutCandles([up, down], 280, 104);
    expect(laid).not.toBeNull();
    expect(laid!.length).toBe(2);
    expect(laid![0].up).toBe(true);
    expect(laid![1].up).toBe(false);
    for (const c of laid!) {
      for (const y of [c.yHigh, c.yLow, c.yOpen, c.yClose]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(104);
      }
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(280);
    }
  });
  it("keeps only the most recent 40 candles", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      open: String(10 + i),
      high: String(12 + i),
      low: String(9 + i),
      close: String(11 + i),
    }));
    expect(layoutCandles(many, 280, 104)!.length).toBe(40);
  });
});
