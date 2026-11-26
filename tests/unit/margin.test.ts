import { describe, expect, it } from "vitest";
import { calcMargin } from "@/lib/tools/margin";
import { findPreset } from "@/lib/trading/instruments";

const XAUUSD = findPreset("XAUUSD")!;
const USDJPY = findPreset("USDJPY")!;

const base = {
  equity: "10000",
  balance: "10000",
  leverage: "100",
  accountCurrency: "USD",
  positions: [],
};

describe("calcMargin", () => {
  it("calculates margin in account currency when quote and account currencies match", () => {
    const result = calcMargin({
      ...base,
      positions: [{ symbol: "XAUUSD", instrument: XAUUSD, lots: "1", entry: "2345" }],
    });

    expect(result.valid).toBe(true);
    expect(result.usedMargin?.toString()).toBe("2345");
    expect(result.freeMargin?.toString()).toBe("7655");
    expect(result.positions[0].notional?.toString()).toBe("234500");
    expect(result.positions[0].requiredMargin?.toString()).toBe("2345");
  });

  it("blocks mixed-currency margin totals when an FX rate is missing", () => {
    const result = calcMargin({
      ...base,
      positions: [{ symbol: "USDJPY", instrument: USDJPY, lots: "1", entry: "149" }],
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MISSING_CONVERSION_RATE");
    expect(result.missingFxSymbols).toEqual(["USDJPY"]);
    expect(result.usedMargin).toBeNull();
    expect(result.positions[0].requiredMargin).toBeNull();
  });

  it("converts notional and margin into account currency", () => {
    const result = calcMargin({
      ...base,
      fxRates: [{ base: "JPY", quote: "USD", rate: "0.006" }],
      positions: [{ symbol: "USDJPY", instrument: USDJPY, lots: "1", entry: "149" }],
    });

    expect(result.valid).toBe(true);
    expect(result.positions[0].notional?.toString()).toBe("89400");
    expect(result.positions[0].requiredMargin?.toString()).toBe("894");
    expect(result.usedMargin?.toString()).toBe("894");
    expect(result.freeMargin?.toString()).toBe("9106");
  });

  it("aggregates positions with different quote currencies only after conversion", () => {
    const result = calcMargin({
      ...base,
      fxRates: [{ base: "JPY", quote: "USD", rate: "0.006" }],
      positions: [
        { symbol: "XAUUSD", instrument: XAUUSD, lots: "1", entry: "2345" },
        { symbol: "USDJPY", instrument: USDJPY, lots: "1", entry: "149" },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.usedMargin?.toString()).toBe("3239");
  });

  it("rejects non-positive leverage and invalid margin-level ordering", () => {
    const zeroLeverage = calcMargin({ ...base, leverage: "0", positions: [] });
    const invalidLevels = calcMargin({
      ...base,
      marginCallLevel: "100",
      stopOutLevel: "120",
      positions: [],
    });

    expect(zeroLeverage.reason).toBe("INVALID_LEVERAGE");
    expect(invalidLevels.reason).toBe("INVALID_MARGIN_LEVELS");
  });

  it("requires an account currency", () => {
    const result = calcMargin({
      equity: "10000",
      balance: "10000",
      leverage: "100",
      positions: [{ symbol: "XAUUSD", instrument: XAUUSD, lots: "1", entry: "2345" }],
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MISSING_ACCOUNT_CURRENCY");
  });
});
