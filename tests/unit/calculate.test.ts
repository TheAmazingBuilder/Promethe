/**
 * Unit tests — calculation engine (addendum §11.8).
 * Every value below was computed by hand from the documented conventions:
 * XAUUSD pip = 0.10, contract 100 oz ; forex pip = 0.0001 (JPY 0.01),
 * contract 100 000. All assertions use exact decimal comparisons.
 */
import { describe, expect, it } from "vitest";
import {
  calcPnL,
  calcPlannedRR,
  calcPositionSize,
  calcRMultiple,
  classifyResult,
  priceDiff,
  toPips,
  toPoints,
  previewTrade,
  stopDistance,
} from "@/lib/trading/calculate";
import { PRESET_INSTRUMENTS, findPreset } from "@/lib/trading/instruments";
import { Decimal } from "@/lib/trading/dec";

const XAUUSD = findPreset("XAUUSD")!;
const EURUSD = findPreset("EURUSD")!;
const USDJPY = findPreset("USDJPY")!;

function dec(v: string | number): Decimal {
  return new Decimal(v);
}

describe("priceDiff", () => {
  it("LONG: exit − entry", () => {
    expect(priceDiff("LONG", "2345.00", "2351.80").toString()).toBe("6.8");
  });
  it("SHORT: entry − exit (signed for direction)", () => {
    expect(priceDiff("SHORT", "2351.80", "2345.00").toString()).toBe("6.8");
  });
  it("negative when adverse", () => {
    expect(priceDiff("LONG", "2345.00", "2340.00").toString()).toBe("-5");
  });
});

describe("toPips / toPoints", () => {
  it("XAUUSD: 6.80 → 68 pips (pip = 0.10)", () => {
    expect(toPips(XAUUSD, "6.8").toString()).toBe("68");
  });
  it("XAUUSD: 6.80 → 680 points (point = 0.01)", () => {
    expect(toPoints(XAUUSD, "6.8").toString()).toBe("680");
  });
  it("EURUSD: 0.0024 → 24 pips", () => {
    expect(toPips(EURUSD, "0.0024").toString()).toBe("24");
  });
  it("USDJPY: 1.00 → 100 pips (pip = 0.01)", () => {
    expect(toPips(USDJPY, "1").toString()).toBe("100");
  });
});

describe("stopDistance / R multiples", () => {
  it("LONG stop below entry → positive distance", () => {
    expect(stopDistance("LONG", "2345.00", "2340.00")!.toString()).toBe("5");
  });
  it("LONG stop above entry → null (wrong side)", () => {
    expect(stopDistance("LONG", "2345.00", "2350.00")).toBeNull();
  });
  it("SHORT stop above entry → positive distance", () => {
    expect(stopDistance("SHORT", "2345.00", "2350.00")!.toString()).toBe("5");
  });
  it("R multiple: 6.80 / 5.00 = 1.36", () => {
    const r = calcRMultiple("LONG", "2345.00", "2351.80", "2340.00")!;
    expect(r.toString()).toBe("1.36");
  });
  it("planned RR: reward 13 / risk 5 = 2.6", () => {
    const rr = calcPlannedRR("LONG", "2345.00", "2340.00", "2358.00")!;
    expect(rr.toString()).toBe("2.6");
  });
  it("R is null without a valid stop", () => {
    expect(calcRMultiple("LONG", "2345.00", "2351.80", null)).toBeNull();
  });
});

describe("calcPnL", () => {
  it("XAUUSD long 0.5 lot, 68 pips → +340 USD gross", () => {
    const r = calcPnL({
      instrument: XAUUSD,
      direction: "LONG",
      lots: "0.5",
      entry: "2345.00",
      exit: "2351.80",
      accountCurrency: "USD",
    });
    expect(r.pips.toString()).toBe("68");
    expect(r.grossPnl.toString()).toBe("340");
    expect(r.isEstimate).toBe(false);
  });

  it("XAUUSD short 0.5 lot, same move → +340 USD", () => {
    const r = calcPnL({
      instrument: XAUUSD,
      direction: "SHORT",
      lots: "0.5",
      entry: "2351.80",
      exit: "2345.00",
      accountCurrency: "USD",
    });
    expect(r.grossPnl.toString()).toBe("340");
  });

  it("EURUSD 1 lot, 24 pips → +240 USD", () => {
    const r = calcPnL({
      instrument: EURUSD,
      direction: "LONG",
      lots: "1",
      entry: "1.08000",
      exit: "1.08240",
      accountCurrency: "USD",
    });
    expect(r.pips.toString()).toBe("24");
    expect(r.grossPnl.toString()).toBe("240");
  });

  it("USDJPY with quote→account conversion (JPY ≠ USD → estimate)", () => {
    const r = calcPnL({
      instrument: USDJPY,
      direction: "LONG",
      lots: "1",
      entry: "149.000",
      exit: "150.000",
      quoteToAccountRate: "0.006", // 1 JPY = 0.006 USD
      accountCurrency: "USD",
    });
    // gross quote = 1.00 × 100 000 = 100 000 JPY → × 0.006 = 600 USD
    expect(r.grossPnlQuote.toString()).toBe("100000");
    expect(r.grossPnl.toString()).toBe("600");
    expect(r.converted).toBe(true);
    expect(r.isEstimate).toBe(true);
  });

  it("signed costs: net = gross − (commission + swap + fees)", () => {
    const r = calcPnL({
      instrument: XAUUSD,
      direction: "LONG",
      lots: "0.5",
      entry: "2345.00",
      exit: "2351.80",
      commission: "7",
      swap: "0",
      fees: "0",
      accountCurrency: "USD",
    });
    expect(r.totalCosts.toString()).toBe("7");
    expect(r.netPnl.toString()).toBe("333");
  });

  it("negative swap (credit) increases net", () => {
    const r = calcPnL({
      instrument: XAUUSD,
      direction: "LONG",
      lots: "0.5",
      entry: "2345.00",
      exit: "2351.80",
      commission: "7",
      swap: "-2",
      accountCurrency: "USD",
    });
    expect(r.totalCosts.toString()).toBe("5");
    expect(r.netPnl.toString()).toBe("335");
  });
});

describe("classifyResult", () => {
  it("positive net → WIN", () => {
    expect(classifyResult("50")).toBe("WIN");
  });
  it("negative net → LOSS", () => {
    expect(classifyResult("-50")).toBe("LOSS");
  });
  it("zero net → BREAKEVEN", () => {
    expect(classifyResult("0")).toBe("BREAKEVEN");
  });
  it("|R| ≤ 0.1 → BREAKEVEN even with a small net gain", () => {
    expect(classifyResult("12", "0.05")).toBe("BREAKEVEN");
  });
  it("|R| > 0.1 → WIN", () => {
    expect(classifyResult("120", "1.2")).toBe("WIN");
  });
  it("custom threshold is honored", () => {
    expect(classifyResult("120", "1.2", "2")).toBe("BREAKEVEN");
  });
});

describe("calcPositionSize", () => {
  it("EURUSD: 100 USD risk, 50-pip stop → exactly 0.20 lot", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "1.08000",
      stopLoss: "1.07500",
      instrument: EURUSD,
      direction: "LONG",
    });
    expect(r.valid).toBe(true);
    expect(r.lots.toString()).toBe("0.2");
    expect(r.actualRiskAmount.toString()).toBe("100");
    expect(r.stopPips!.toString()).toBe("50");
  });

  it("rounds DOWN to the lot step — actual risk never exceeds the request", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskAmount: "33",
      entry: "2345.00",
      stopLoss: "2340.00",
      instrument: XAUUSD,
      direction: "LONG",
    });
    // units = 33/5 = 6.6 → lots 0.066 → floored to 0.06
    expect(r.lots.toString()).toBe("0.06");
    expect(r.actualRiskAmount.toString()).toBe("30");
    expect(r.actualRiskAmount.lte(dec("33"))).toBe(true);
  });

  it("LONG with SL above entry → STOP_SIDE_LONG", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "2345.00",
      stopLoss: "2350.00",
      instrument: XAUUSD,
      direction: "LONG",
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("STOP_SIDE_LONG");
  });

  it("SHORT with SL below entry → STOP_SIDE_SHORT", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "2345.00",
      stopLoss: "2340.00",
      instrument: XAUUSD,
      direction: "SHORT",
    });
    expect(r.reason).toBe("STOP_SIDE_SHORT");
  });

  it("entry == SL without direction → STOP_EQUALS_ENTRY", () => {
    const r = calcPositionSize({
      accountBalance: "10000",
      riskPercent: "1",
      entry: "2345.00",
      stopLoss: "2345.00",
      instrument: XAUUSD,
    });
    expect(r.reason).toBe("STOP_EQUALS_ENTRY");
  });

  it("zero balance → INVALID_AMOUNT", () => {
    const r = calcPositionSize({
      accountBalance: "0",
      riskPercent: "1",
      entry: "2345.00",
      stopLoss: "2340.00",
      instrument: XAUUSD,
      direction: "LONG",
    });
    expect(r.reason).toBe("INVALID_AMOUNT");
  });

  it("risk too small for the minimum lot → INSUFFICIENT_RISK + minLots", () => {
    const r = calcPositionSize({
      accountBalance: "10",
      riskAmount: "1",
      entry: "2345.00",
      stopLoss: "2340.00",
      instrument: XAUUSD,
      direction: "LONG",
    });
    // units = 1/5 = 0.2 → lots 0.002 → floored to 0
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("INSUFFICIENT_RISK");
    expect(r.minLots.toString()).toBe("0.01");
  });

  it("maxLots caps the position", () => {
    const r = calcPositionSize({
      accountBalance: "100000",
      riskPercent: "10",
      entry: "2345.00",
      stopLoss: "2340.00",
      instrument: XAUUSD,
      direction: "LONG",
      maxLots: "1",
    });
    expect(r.lots.toString()).toBe("1");
  });
});

describe("previewTrade (live form aggregate)", () => {
  it("XAUUSD reference case: pips, R, RR, net", () => {
    const p = previewTrade({
      instrument: XAUUSD,
      direction: "LONG",
      lots: "0.5",
      entry: "2345.00",
      exit: "2351.80",
      stopLoss: "2340.00",
      takeProfit: "2358.00",
      commission: "7",
      accountCurrency: "USD",
      accountBalance: "10000",
    });
    expect(p.pips.toString()).toBe("68");
    expect(p.netPnl.toString()).toBe("333");
    expect(p.rMultiple!.toString()).toBe("1.36");
    expect(p.plannedRR!.toString()).toBe("2.6");
    // riskAmount = 5.00 × 50 oz = 250 → realizedRR = 333/250
    expect(p.riskAmount!.toString()).toBe("250");
    expect(p.realizedRR!.toString()).toBe("1.332");
    expect(p.riskPercent!.toString()).toBe("2.5");
    expect(p.resultType).toBe("WIN");
  });

  it("breakeven classification via R threshold", () => {
    const p = previewTrade({
      instrument: XAUUSD,
      direction: "LONG",
      lots: "0.5",
      entry: "2345.00",
      exit: "2345.30", // +3 pips ≈ 0.06R
      stopLoss: "2340.00",
      accountCurrency: "USD",
    });
    expect(p.resultType).toBe("BREAKEVEN");
  });
});

describe("instrument presets sanity", () => {
  it("37 presets with distinct symbols", () => {
    const symbols = new Set(PRESET_INSTRUMENTS.map((i) => i.symbol));
    expect(PRESET_INSTRUMENTS.length).toBe(37);
    expect(symbols.size).toBe(37);
  });
  it("XAUUSD convention: pip 0.10, point 0.01, contract 100", () => {
    expect(XAUUSD.pipSize).toBe("0.10");
    expect(XAUUSD.pointSize).toBe("0.01");
    expect(XAUUSD.contractSize).toBe("100");
  });
});
