import { describe, expect, it } from "vitest";
import { calcMultiTp } from "@/lib/tools/multi-tp";
import { findPreset } from "@/lib/trading/instruments";

const XAUUSD = findPreset("XAUUSD")!;
const USDJPY = findPreset("USDJPY")!;

describe("calcMultiTp currency handling", () => {
  it("requires account currency before sizing", () => {
    const result = calcMultiTp({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "2345",
      stopLoss: "2340",
      instrument: XAUUSD,
      direction: "LONG",
      tiers: [{ price: "2350", allocationPct: "100" }],
    });

    expect(result.sizing.valid).toBe(false);
    expect(result.sizing.reason).toBe("MISSING_ACCOUNT_CURRENCY");
  });

  it("blocks cross-currency sizing without a quote-to-account rate", () => {
    const result = calcMultiTp({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "149",
      stopLoss: "148",
      instrument: USDJPY,
      direction: "LONG",
      accountCurrency: "USD",
      tiers: [{ price: "150", allocationPct: "100" }],
    });

    expect(result.sizing.valid).toBe(false);
    expect(result.sizing.reason).toBe("MISSING_CONVERSION_RATE");
    expect(result.totalGrossPnl.isZero()).toBe(true);
  });

  it("converts tier P&L and sizes the position in account currency", () => {
    const result = calcMultiTp({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "149",
      stopLoss: "148",
      instrument: USDJPY,
      direction: "LONG",
      accountCurrency: "USD",
      quoteToAccountRate: "0.006",
      tiers: [{ price: "150", allocationPct: "100" }],
    });

    expect(result.sizing.valid).toBe(true);
    expect(result.sizing.lots.toString()).toBe("0.16");
    expect(result.tiers[0].grossPnl.toString()).toBe("96");
    expect(result.totalGrossPnl.toString()).toBe("96");
    expect(result.sizing.isEstimate).toBe(true);
  });

  it("keeps same-currency calculations exact without an FX rate", () => {
    const result = calcMultiTp({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "2345",
      stopLoss: "2340",
      instrument: XAUUSD,
      direction: "LONG",
      accountCurrency: "USD",
      tiers: [{ price: "2350", allocationPct: "100" }],
    });

    expect(result.sizing.valid).toBe(true);
    expect(result.sizing.isEstimate).toBe(false);
    expect(result.tiers[0].grossPnl.toString()).toBe("100");
  });
});

describe("calcMultiTp input validation", () => {
  const base = {
    accountBalance: "10000",
    riskPercent: "1",
    entry: "2345",
    stopLoss: "2340",
    instrument: XAUUSD,
    direction: "LONG" as const,
    accountCurrency: "USD",
  };

  it("rejects negative and over-100 allocations even when their sum is 100", () => {
    const result = calcMultiTp({
      ...base,
      tiers: [
        { price: "2350", allocationPct: "-50" },
        { price: "2360", allocationPct: "150" },
      ],
    });

    expect(result.allocationValid).toBe(false);
    expect(result.blendedR).toBeNull();
    expect(result.totalGrossPnl.isZero()).toBe(true);
    expect(result.tiers.every((tier) => tier.lots.isZero())).toBe(true);
  });

  it("requires allocations to sum to exactly 100", () => {
    const result = calcMultiTp({
      ...base,
      tiers: [{ price: "2350", allocationPct: "80" }],
    });

    expect(result.allocationValid).toBe(false);
    expect(result.totalGrossPnl.isZero()).toBe(true);
  });

  it("rejects a take-profit on the wrong side of entry", () => {
    const result = calcMultiTp({
      ...base,
      tiers: [{ price: "2340", allocationPct: "100" }],
    });

    expect(result.targetsValid).toBe(false);
    expect(result.blendedR).toBeNull();
    expect(result.totalGrossPnl.isZero()).toBe(true);
  });

  it("accepts valid positive allocations and directionally valid targets", () => {
    const result = calcMultiTp({
      ...base,
      tiers: [
        { price: "2350", allocationPct: "60" },
        { price: "2360", allocationPct: "40" },
      ],
    });

    expect(result.allocationValid).toBe(true);
    expect(result.targetsValid).toBe(true);
    expect(result.blendedR).not.toBeNull();
    expect(result.totalGrossPnl.gt(0)).toBe(true);
  });
});
