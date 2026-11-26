/**
 * Lot 1 Phase C (MD §3.6, item 7a) — multi-TP lot rounding + costs.
 *
 * Tier lots must be tradable volumes (broker step), never fractions
 * like 0.0666; cumulative P&L must include costs (net) or be labelled
 * gross explicitly.
 */
import { describe, expect, it } from "vitest";
import { calcMultiTp } from "@/lib/tools/multi-tp";
import { findPreset } from "@/lib/trading/instruments";

const XAUUSD = findPreset("XAUUSD")!;

const base = {
  accountBalance: "10000",
  riskPercent: "1",
  entry: "2345",
  stopLoss: "2340",
  instrument: XAUUSD,
  direction: "LONG" as const,
  accountCurrency: "USD",
  tiers: [
    { price: "2350", allocationPct: "50" },
    { price: "2360", allocationPct: "30" },
    { price: "2380", allocationPct: "20" },
  ],
};

describe("tier lot rounding (7a)", () => {
  it("rounds tier lots down to the volume step (no 0.0666 fractions)", () => {
    // Total 0.2 lots: 50% → 0.10, 30% → 0.06, 20% → 0.04 — all on-step.
    // A 3-way 33/33/34 split of 0.2 lots would give 0.066 raw per tier.
    const r = calcMultiTp({
      ...base,
      tiers: [
        { price: "2350", allocationPct: "33" },
        { price: "2360", allocationPct: "33" },
        { price: "2380", allocationPct: "34" },
      ],
    });
    expect(r.sizing.valid).toBe(true);
    expect(r.sizing.lots.toString()).toBe("0.2");
    // 0.066 → 0.06, 0.066 → 0.06, 0.068 → 0.06 + 0.02 remainder = 0.08
    expect(r.tiers.map((t) => t.lots.toString())).toEqual(["0.06", "0.06", "0.08"]);
    expect(
      r.tiers[0].lots.plus(r.tiers[1].lots).plus(r.tiers[2].lots).toString()
    ).toBe("0.2");
    expect(r.unallocatedLots.toString()).toBe("0");
  });

  it("keeps tier lots on the step with the default 50/30/20 split", () => {
    const r = calcMultiTp(base);
    expect(r.tiers.map((t) => t.lots.toString())).toEqual(["0.1", "0.06", "0.04"]);
  });

  it("rounds to a coarser step when the broker step is 0.05", () => {
    const r = calcMultiTp({ ...base, lotStep: "0.05", minLots: "0.05" });
    expect(r.sizing.valid).toBe(true);
    // Total 0.2 lots is already on the 0.05 grid.
    for (const tier of r.tiers) {
      expect(tier.lots.mod("0.05").isZero()).toBe(true);
    }
  });
});

describe("costs in cumulative P&L (7a)", () => {
  it("reports net P&L alongside gross when costs are given", () => {
    const r = calcMultiTp({ ...base, commission: "7", swap: "3" });
    expect(r.totalCosts.toString()).toBe("10");
    // Gross: 0.1×500 + 0.06×1500 + 0.04×3500 = 50 + 90 + 140 = 280
    expect(r.totalGrossPnl.toString()).toBe("280");
    expect(r.totalNetPnl.toString()).toBe("270");
    // Per-tier net = gross − pro-rata share of the 10 costs.
    expect(r.tiers[0].grossPnl.toString()).toBe("50");
    expect(r.tiers[0].netPnl.toString()).toBe("45");
    expect(r.tiers[1].netPnl.toString()).toBe("87");
    expect(r.tiers[2].netPnl.toString()).toBe("138");
    // Worst case net of costs: −100 − 10.
    expect(r.worstCasePnl.toString()).toBe("-100");
    expect(r.worstCaseNetPnl.toString()).toBe("-110");
  });

  it("net equals gross when no costs are given (gross label applies)", () => {
    const r = calcMultiTp(base);
    expect(r.totalCosts.toString()).toBe("0");
    expect(r.totalNetPnl.toString()).toBe(r.totalGrossPnl.toString());
    expect(r.tiers[0].netPnl.toString()).toBe(r.tiers[0].grossPnl.toString());
  });
});
