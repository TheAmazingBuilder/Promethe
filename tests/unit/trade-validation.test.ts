/**
 * Lot 1 (MD §3.2) — directional TP/SL validation on the trade input schema.
 *
 * A wrong-side TP/SL used to be stored silently (plannedRR computed as
 * null). It is now rejected at the schema (422 VALIDATION at the API),
 * while the PATCH schema stays partial — merged values are validated
 * server-side in updateTrade, so historical trades are untouched unless
 * those fields are edited.
 */
import { describe, expect, it } from "vitest";
import {
  closeTradeSchema,
  tradeInputSchema,
  tradePatchSchema,
} from "@/lib/validations/trade";
import { pipsFromPrices } from "@/lib/trading/template";
import { findPreset } from "@/lib/trading/instruments";

const XAUUSD = findPreset("XAUUSD")!;

const base = {
  accountId: "acc-1",
  instrumentId: "ins-1",
  direction: "LONG",
  entryTime: "2026-11-20T10:00:00.000Z",
  entryPrice: "2345.00",
  lots: "0.2",
} as const;

function issuesFor(input: Record<string, unknown>) {
  const parsed = tradeInputSchema.safeParse({ ...base, ...input });
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

describe("tradeInputSchema — directional TP/SL", () => {
  it("accepts a valid BUY (TP above, SL below entry)", () => {
    expect(tradeInputSchema.safeParse({ ...base, stopLoss: "2340.00", takeProfit: "2358.00" }).success).toBe(true);
  });

  it("accepts a valid SELL (TP below, SL above entry)", () => {
    expect(
      tradeInputSchema.safeParse({
        ...base,
        direction: "SHORT",
        stopLoss: "2350.00",
        takeProfit: "2332.00",
      }).success
    ).toBe(true);
  });

  it("rejects a BUY take-profit below entry on takeProfit", () => {
    const issues = issuesFor({ stopLoss: "2340.00", takeProfit: "2332.00" });
    expect(issues).toContainEqual({ path: "takeProfit", message: "TP_WRONG_SIDE" });
  });

  it("rejects a SELL take-profit above entry on takeProfit", () => {
    const issues = issuesFor({
      direction: "SHORT",
      stopLoss: "2350.00",
      takeProfit: "2358.00",
    });
    expect(issues).toContainEqual({ path: "takeProfit", message: "TP_WRONG_SIDE" });
  });

  it("rejects a BUY stop-loss above entry on stopLoss", () => {
    const issues = issuesFor({ stopLoss: "2350.00", takeProfit: "2358.00" });
    expect(issues).toContainEqual({ path: "stopLoss", message: "SL_WRONG_SIDE" });
  });

  it("rejects a SELL stop-loss below entry on stopLoss", () => {
    const issues = issuesFor({
      direction: "SHORT",
      stopLoss: "2340.00",
      takeProfit: "2332.00",
    });
    expect(issues).toContainEqual({ path: "stopLoss", message: "SL_WRONG_SIDE" });
  });

  it("rejects entry == take-profit and entry == stop-loss", () => {
    expect(issuesFor({ stopLoss: "2340.00", takeProfit: "2345.00" })).toContainEqual({
      path: "takeProfit",
      message: "TP_EQUALS_ENTRY",
    });
    expect(issuesFor({ stopLoss: "2345.00", takeProfit: "2358.00" })).toContainEqual({
      path: "stopLoss",
      message: "SL_EQUALS_ENTRY",
    });
  });

  it("accepts missing TP/SL (open trade without levels)", () => {
    expect(tradeInputSchema.safeParse({ ...base }).success).toBe(true);
  });
});

describe("tradePatchSchema — stays partial after the refine restructure", () => {
  it("accepts a patch touching only unrelated fields", () => {
    expect(tradePatchSchema.safeParse({ notes: "review later" }).success).toBe(true);
  });

  it("does not reject a lone takeProfit at schema level (merged values are checked server-side)", () => {
    // A partial patch carries no entry/direction, so the schema cannot
    // judge the side; updateTrade validates the merged trade instead.
    expect(tradePatchSchema.safeParse({ takeProfit: "2332.00" }).success).toBe(true);
  });
});

describe("tradeInputSchema — manual P&L requires its value (MD §3.3)", () => {
  it("rejects pnlSource MANUAL without manualNetPnl on manualNetPnl", () => {
    const issues = issuesFor({ pnlSource: "MANUAL", status: "CLOSED", exitPrice: "2351.80" });
    expect(issues).toContainEqual({ path: "manualNetPnl", message: "manualNetPnlRequired" });
  });

  it("accepts pnlSource MANUAL with a manual value (including 0)", () => {
    expect(
      tradeInputSchema.safeParse({
        ...base,
        status: "CLOSED",
        exitPrice: "2351.80",
        pnlSource: "MANUAL",
        manualNetPnl: "123.45",
      }).success
    ).toBe(true);
    expect(
      tradeInputSchema.safeParse({
        ...base,
        status: "CLOSED",
        exitPrice: "2351.80",
        pnlSource: "MANUAL",
        manualNetPnl: "0",
      }).success
    ).toBe(true);
  });

  it("accepts CALCULATED without a manual value (calculated P&L is derived)", () => {
    expect(
      tradeInputSchema.safeParse({ ...base, status: "CLOSED", exitPrice: "2351.80" }).success
    ).toBe(true);
  });
});

describe("tradePatchSchema — manual P&L (MD §3.3)", () => {
  it("rejects explicitly clearing the manual value while staying MANUAL", () => {
    const parsed = tradePatchSchema.safeParse({ pnlSource: "MANUAL", manualNetPnl: null });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      ).toContainEqual({ path: "manualNetPnl", message: "manualNetPnlRequired" });
    }
  });

  it("allows a patch that does not mention the manual value (server carries the stored value)", () => {
    expect(tradePatchSchema.safeParse({ pnlSource: "MANUAL" }).success).toBe(true);
    expect(tradePatchSchema.safeParse({ notes: "review later" }).success).toBe(true);
  });
});

describe("closeTradeSchema — manual P&L (MD §3.3)", () => {
  it("rejects an explicitly MANUAL close without a value", () => {
    const parsed = closeTradeSchema.safeParse({ exitPrice: "2351.80", pnlSource: "MANUAL" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      ).toContainEqual({ path: "manualNetPnl", message: "manualNetPnlRequired" });
    }
  });

  it("accepts a MANUAL close with a value and a close that leaves the source untouched", () => {
    expect(
      closeTradeSchema.safeParse({
        exitPrice: "2351.80",
        pnlSource: "MANUAL",
        manualNetPnl: "42",
      }).success
    ).toBe(true);
    expect(closeTradeSchema.safeParse({ exitPrice: "2351.80" }).success).toBe(true);
  });
});

describe("pipsFromPrices — directional (MD §3.2)", () => {
  it("legacy call without direction still returns the absolute distance", () => {
    expect(pipsFromPrices("2345.00", "2340.00", XAUUSD)).toBe("50");
    expect(pipsFromPrices("2345.00", "2350.00", XAUUSD)).toBe("50");
  });

  it("STOP: positive on the correct side, negative on the wrong side", () => {
    expect(pipsFromPrices("2345.00", "2340.00", XAUUSD, "LONG", "STOP")).toBe("50");
    expect(pipsFromPrices("2345.00", "2350.00", XAUUSD, "LONG", "STOP")).toBe("-50");
    expect(pipsFromPrices("2345.00", "2350.00", XAUUSD, "SHORT", "STOP")).toBe("50");
    expect(pipsFromPrices("2345.00", "2340.00", XAUUSD, "SHORT", "STOP")).toBe("-50");
  });

  it("TAKE_PROFIT: positive on the correct side, negative on the wrong side", () => {
    expect(pipsFromPrices("2345.00", "2358.00", XAUUSD, "LONG", "TAKE_PROFIT")).toBe("130");
    expect(pipsFromPrices("2345.00", "2332.00", XAUUSD, "LONG", "TAKE_PROFIT")).toBe("-130");
    expect(pipsFromPrices("2345.00", "2332.00", XAUUSD, "SHORT", "TAKE_PROFIT")).toBe("130");
    expect(pipsFromPrices("2345.00", "2358.00", XAUUSD, "SHORT", "TAKE_PROFIT")).toBe("-130");
  });
});
