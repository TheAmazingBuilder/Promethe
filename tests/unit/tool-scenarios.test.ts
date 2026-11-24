/**
 * Lot 1 Phase C (MD §3.5, item 6c; §3.6, item 7b) — scenario round-trips.
 *
 * The server stores payloads as opaque JSON, so these parse helpers are
 * the round-trip: multi-TP used to lose the FX rate and the risk mode
 * on load, risk-reward used to lose the currency. The new POSITION_SIZE
 * and PNL_SIMULATOR kinds are validated by the zod schema too.
 */
import { describe, expect, it } from "vitest";
import {
  parseMultiTpScenario,
  parsePnlSimulatorScenario,
  parsePositionSizeScenario,
  parseRiskRewardScenario,
} from "@/lib/tools/scenario-payloads";
import { toolScenarioInputSchema } from "@/lib/validations/tools";

describe("multi-TP scenario round-trip (6c)", () => {
  it("restores the FX rate and the risk mode on load", () => {
    const payload = {
      symbol: "USDJPY",
      balance: "10000",
      currency: "USD",
      riskMode: "amount",
      riskPercent: "1",
      riskAmount: "250",
      direction: "SHORT",
      entry: "149",
      stopLoss: "150",
      tiers: [
        { price: "148", allocation: "50" },
        { price: "147", allocation: "50" },
      ],
      manualRate: "0.0067",
      commission: "7",
      swap: "2",
    };
    const parsed = parseMultiTpScenario(payload);
    expect(parsed.manualRate).toBe("0.0067");
    expect(parsed.riskMode).toBe("amount");
    expect(parsed.riskAmount).toBe("250");
    expect(parsed.tiers).toEqual([
      { price: "148", allocation: "50" },
      { price: "147", allocation: "50" },
    ]);
    expect(parsed.commission).toBe("7");
  });

  it("drops mistyped fields instead of crashing the load", () => {
    const parsed = parseMultiTpScenario({
      symbol: 42,
      direction: "SIDEWAYS",
      tiers: [{ price: "148" }],
      manualRate: "",
    });
    expect(parsed.symbol).toBeUndefined();
    expect(parsed.direction).toBeUndefined();
    expect(parsed.tiers).toBeUndefined();
    expect(parsed.manualRate).toBeUndefined();
  });
});

describe("position-size scenario round-trip (6c)", () => {
  it("restores basis, equity, costs, volume rules and the FX rate", () => {
    const payload = {
      symbol: "XAUUSD",
      balance: "10000",
      currency: "EUR",
      riskBasis: "EQUITY",
      accountEquity: "12345",
      riskMode: "percent",
      riskPercent: "2",
      riskAmount: "100",
      direction: "LONG",
      entry: "2345",
      stopLoss: "2340",
      rate: "1.08",
      lotStep: "0.01",
      minLots: "0.01",
      maxLots: "5",
      estimatedCosts: "12",
    };
    const parsed = parsePositionSizeScenario(payload);
    expect(parsed.riskBasis).toBe("EQUITY");
    expect(parsed.accountEquity).toBe("12345");
    expect(parsed.rate).toBe("1.08");
    expect(parsed.maxLots).toBe("5");
    expect(parsed.estimatedCosts).toBe("12");
    expect(parsed.currency).toBe("EUR");
  });
});

describe("P&L simulator scenario round-trip (7b)", () => {
  it("restores every simulator field including the manual rate", () => {
    const payload = {
      symbol: "USDJPY",
      direction: "SHORT",
      lots: "0.5",
      entry: "149",
      exit: "148",
      stopLoss: "150",
      takeProfit: "147",
      commission: "7",
      swap: "0",
      accountCurrency: "USD",
      manualRate: "0.0067",
    };
    const parsed = parsePnlSimulatorScenario(payload);
    expect(parsed).toEqual(payload);
  });
});

describe("risk-reward scenario round-trip (6c)", () => {
  it("restores the currency on load", () => {
    const parsed = parseRiskRewardScenario({
      winRate: "0.45",
      rr: "2",
      riskPerTrade: "100",
      currency: "EUR",
    });
    expect(parsed.currency).toBe("EUR");
    expect(parsed.winRate).toBe("0.45");
    expect(parsed.rr).toBe("2");
    expect(parsed.riskPerTrade).toBe("100");
  });
});

describe("tool-scenario kinds (6c, 7b)", () => {
  it("accepts the new POSITION_SIZE and PNL_SIMULATOR kinds", () => {
    for (const kind of ["POSITION_SIZE", "PNL_SIMULATOR"] as const) {
      const parsed = toolScenarioInputSchema.safeParse({
        name: "test",
        kind,
        payload: { symbol: "XAUUSD" },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("still accepts the existing kinds and rejects unknown ones", () => {
    for (const kind of ["MULTI_TP", "MARGIN", "RISK_REWARD"] as const) {
      expect(
        toolScenarioInputSchema.safeParse({ name: "t", kind, payload: {} }).success
      ).toBe(true);
    }
    expect(
      toolScenarioInputSchema.safeParse({ name: "t", kind: "NOPE", payload: {} })
        .success
    ).toBe(false);
  });
});
