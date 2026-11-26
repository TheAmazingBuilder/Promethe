/**
 * Lot 1 Phase C (MD §3.5, item 6) — position-sizing guards.
 *
 * (a) explicit balance vs equity basis; (b) fees/commissions/swap taken
 * off the risk budget when given, "before costs" otherwise; (d) max-lots
 * cap flagged, never a silent valid:true; (e) tick value from instrument
 * presets; (f) absurd risk bound (100%).
 */
import { describe, expect, it } from "vitest";
import {
  calcPositionSize,
  calcTickValue,
  MAX_RISK_PERCENT,
} from "@/lib/trading/calculate";
import { findPreset } from "@/lib/trading/instruments";

const XAUUSD = findPreset("XAUUSD")!;
const EURUSD = findPreset("EURUSD")!;

const base = {
  accountBalance: "10000",
  riskPercent: "1",
  entry: "2345",
  stopLoss: "2340",
  instrument: XAUUSD,
  direction: "LONG" as const,
  accountCurrency: "USD",
};

describe("risk basis (6a)", () => {
  it("defaults to BALANCE and reports the basis used", () => {
    const r = calcPositionSize(base);
    expect(r.valid).toBe(true);
    expect(r.riskBasis).toBe("BALANCE");
    expect(r.basisAmount.toString()).toBe("10000");
    expect(r.riskAmount.toString()).toBe("100");
  });

  it("sizes on equity when EQUITY is chosen with a value", () => {
    const r = calcPositionSize({
      ...base,
      riskBasis: "EQUITY",
      accountEquity: "12000",
    });
    expect(r.valid).toBe(true);
    expect(r.riskBasis).toBe("EQUITY");
    expect(r.basisAmount.toString()).toBe("12000");
    // 1% of 12000 = 120 risk → 120 / 5 = 24 units → 0.24 lots
    expect(r.riskAmount.toString()).toBe("120");
    expect(r.lots.toString()).toBe("0.24");
  });

  it("rejects EQUITY with no equity value instead of falling back to balance", () => {
    const r = calcPositionSize({ ...base, riskBasis: "EQUITY" });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("EQUITY_UNAVAILABLE");
  });

  it("rejects EQUITY with a zero or negative equity value", () => {
    for (const accountEquity of ["0", "-500", "not-a-number"]) {
      const r = calcPositionSize({ ...base, riskBasis: "EQUITY", accountEquity });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("EQUITY_UNAVAILABLE");
    }
  });
});

describe("costs in sizing (6b)", () => {
  it("sizes on risk minus costs when estimated costs are given", () => {
    const r = calcPositionSize({ ...base, estimatedCosts: "20" });
    expect(r.valid).toBe(true);
    expect(r.costsDeducted.toString()).toBe("20");
    // (100 − 20) / 5 = 16 units → 0.16 lots; risk taken + costs = 100
    expect(r.lots.toString()).toBe("0.16");
    expect(r.actualRiskAmount.toString()).toBe("80");
    expect(r.actualRiskAmount.plus(r.costsDeducted).toString()).toBe("100");
  });

  it("is explicitly before-costs when no costs are given", () => {
    const r = calcPositionSize(base);
    expect(r.valid).toBe(true);
    expect(r.costsDeducted.toString()).toBe("0");
    expect(r.lots.toString()).toBe("0.2");
  });

  it("rejects costs equal to or greater than the risk budget", () => {
    for (const estimatedCosts of ["100", "150"]) {
      const r = calcPositionSize({ ...base, estimatedCosts });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("COSTS_EXCEED_RISK");
    }
  });
});

describe("max-lots cap indicator (6d)", () => {
  it("flags capped instead of returning a silent valid size", () => {
    const r = calcPositionSize({ ...base, maxLots: "0.1" });
    expect(r.valid).toBe(true);
    expect(r.capped).toBe(true);
    expect(r.lots.toString()).toBe("0.1");
    expect(r.actualRiskAmount.toString()).toBe("50");
  });

  it("is not capped when the computed size fits under maxLots", () => {
    const r = calcPositionSize({ ...base, maxLots: "1" });
    expect(r.valid).toBe(true);
    expect(r.capped).toBe(false);
    expect(r.lots.toString()).toBe("0.2");
  });

  it("is not capped when maxLots equals the computed size exactly", () => {
    const r = calcPositionSize({ ...base, maxLots: "0.2" });
    expect(r.valid).toBe(true);
    expect(r.capped).toBe(false);
  });
});

describe("tick value (6e)", () => {
  it("derives the tick value from the preset tickSize for XAUUSD", () => {
    // tickSize 0.01 × contract 100 × 0.2 lots = 0.20 USD per tick
    const r = calcPositionSize(base);
    expect(r.valid).toBe(true);
    expect(r.tickDataMissing).toBe(false);
    expect(r.tickValue?.quote.toString()).toBe("0.2");
    expect(r.tickValue?.account.toString()).toBe("0.2");
  });

  it("reports missing tick data for EURUSD (no tickSize/tickValue in the preset)", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "1.08",
      stopLoss: "1.07",
      instrument: EURUSD,
      direction: "LONG",
      accountCurrency: "USD",
    });
    expect(r.valid).toBe(true);
    expect(r.tickDataMissing).toBe(true);
    expect(r.tickValue).toBeNull();
  });

  it("prefers an explicit per-lot tickValue when the preset carries one", () => {
    const v = calcTickValue(
      { ...XAUUSD, tickValue: "1.5" },
      "0.2"
    );
    expect(v?.quote.toString()).toBe("0.3");
  });

  it("converts the tick value to the account currency", () => {
    const v = calcTickValue({ ...XAUUSD }, "0.2", "0.5");
    expect(v?.quote.toString()).toBe("0.2");
    expect(v?.account.toString()).toBe("0.1");
  });
});

describe("absurd-risk bound (6f)", () => {
  it("rejects a risk percent above 100%", () => {
    expect(MAX_RISK_PERCENT).toBe(100);
    for (const riskPercent of ["100.01", "150", "1000"]) {
      const r = calcPositionSize({ ...base, riskPercent });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("RISK_PERCENT_TOO_HIGH");
    }
  });

  it("allows exactly 100% risk", () => {
    const r = calcPositionSize({ ...base, riskPercent: "100" });
    expect(r.valid).toBe(true);
    expect(r.riskAmount.toString()).toBe("10000");
  });

  it("rejects a fixed risk amount above the basis", () => {
    const r = calcPositionSize({
      ...base,
      riskPercent: null,
      riskAmount: "10001",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("RISK_PERCENT_TOO_HIGH");
  });

  it("applies the bound to the equity basis too", () => {
    const r = calcPositionSize({
      ...base,
      riskBasis: "EQUITY",
      accountEquity: "5000",
      riskPercent: "101",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("RISK_PERCENT_TOO_HIGH");
  });
});
