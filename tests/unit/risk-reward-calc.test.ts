/**
 * Unit tests — Risk / Reward pure engine (Phase 2).
 * Every value below was computed by hand from the documented formulas:
 * required win rate p* = 1 / (1 + RR), expectancy E = p·gain − (1−p)·loss.
 */
import { describe, expect, it } from "vitest";
import {
  classifyRrCell,
  compoundProjection,
  expectancyMoney,
  expectancyR,
  requiredWinRate,
} from "../../src/lib/trading/calculate";

describe("requiredWinRate", () => {
  it("1:1 → 50%, 1:2 → 33.3%, 1:3 → 25%, 1:4 → 20%, 1:5 → 16.7%", () => {
    expect(requiredWinRate(1)?.toString()).toBe("0.5");
    expect(requiredWinRate(2)?.toNumber()).toBeCloseTo(1 / 3, 10);
    expect(requiredWinRate(3)?.toString()).toBe("0.25");
    expect(requiredWinRate(4)?.toString()).toBe("0.2");
    expect(requiredWinRate(5)?.toNumber()).toBeCloseTo(1 / 6, 10);
  });

  it("RR ≤ 0 → null", () => {
    expect(requiredWinRate(0)).toBeNull();
    expect(requiredWinRate(-1)).toBeNull();
  });
});

describe("expectancyR", () => {
  it("40% at 2:1 → +0.2 R per trade", () => {
    expect(expectancyR(0.4, 2)?.toString()).toBe("0.2");
  });

  it("50% at 1:1 → exactly break-even", () => {
    expect(expectancyR(0.5, 1)?.toString()).toBe("0");
  });

  it("30% at 1:1 → −0.4 R per trade", () => {
    expect(expectancyR(0.3, 1)?.toString()).toBe("-0.4");
  });

  it("invalid inputs → null", () => {
    expect(expectancyR(1.5, 2)).toBeNull();
    expect(expectancyR(0.5, -1)).toBeNull();
  });
});

describe("expectancyMoney", () => {
  it("40% win, avg win $200, avg loss $100 → +$20 per trade", () => {
    expect(
      expectancyMoney({ winRate: 0.4, avgWin: 200, avgLoss: 100 })?.toString()
    ).toBe("20");
  });

  it("matches expectancyR × risk: 40% at 2:1 risking $100 → +$20", () => {
    expect(
      expectancyMoney({ winRate: 0.4, avgWin: 200, avgLoss: 100 })?.toString()
    ).toBe(expectancyR(0.4, 2)?.times(100).toString());
  });
});

describe("classifyRrCell", () => {
  it("matches the reference table: 1:1@50% and 4:1@20% are break-even", () => {
    expect(classifyRrCell(1, 0.5)).toBe("breakeven");
    expect(classifyRrCell(4, 0.2)).toBe("breakeven");
    expect(classifyRrCell(1, 0.4)).toBe("losing");
    expect(classifyRrCell(1, 0.6)).toBe("profitable");
    expect(classifyRrCell(5, 0.2)).toBe("profitable");
    expect(classifyRrCell(2, 0.3)).toBe("losing");
    expect(classifyRrCell(3, 0.3)).toBe("profitable");
  });
});

describe("compoundProjection", () => {
  it("compounds monthly: $10,000, 0.2 R, 1% risk, 20 trades/month, 2 months", () => {
    const points = compoundProjection({
      startingBalance: 10000,
      expectancyR: 0.2,
      riskPerTrade: 0.01,
      tradesPerMonth: 20,
      months: 2,
    });
    // Monthly return = 0.2 × 0.01 × 20 = 4%.
    expect(points.map((p) => p.toString())).toEqual([
      "10000",
      "10400",
      "10816",
    ]);
  });

  it("invalid inputs → [] (never a made-up projection)", () => {
    expect(
      compoundProjection({
        startingBalance: 0,
        expectancyR: 0.2,
        riskPerTrade: 0.01,
        tradesPerMonth: 20,
        months: 12,
      })
    ).toEqual([]);
    expect(
      compoundProjection({
        startingBalance: 10000,
        expectancyR: 0.2,
        riskPerTrade: 0.01,
        tradesPerMonth: 20,
        months: 0,
      })
    ).toEqual([]);
  });
});
