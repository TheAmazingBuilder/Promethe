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
