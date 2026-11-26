/**
 * Lot 1 Phase C (MD §3.6, item 7c) — exposure nulls notionals/open risk
 * when FX is missing, consistent with floating P&L (already nulled).
 *
 * Aggregates that mix in an unknown leg are null too — never a partial
 * sum presented as a total. One exception: an open risk supplied by the
 * server as riskAmount is already account currency, so it stays known.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateExposure,
  decomposeTrade,
  detectDuplication,
  type OpenTradeLike,
} from "@/lib/tools/exposure";
import { DEFAULT_EXPOSURE_SETTINGS } from "@/lib/tools/types";
import { findPreset } from "@/lib/trading/instruments";

const USDJPY = findPreset("USDJPY")!;
const EURUSD = findPreset("EURUSD")!;

function jpyTrade(overrides: Partial<OpenTradeLike> = {}): OpenTradeLike {
  return {
    id: "usd-jpy",
    symbol: "USDJPY",
    direction: "LONG",
    lots: "1",
    entryPrice: "149",
    stopLoss: "148",
    currentPrice: "150",
    accountCurrency: "USD",
    ...overrides,
  };
}

describe("FX-missing exposure (7c)", () => {
  it("nulls leg notionals and price-derived open risk when FX is missing", () => {
    const d = decomposeTrade(jpyTrade(), "USD", USDJPY.contractSize);
    expect(d.conversionMissing).toBe(true);
    expect(d.floatingPnl).toBeNull();
    expect(d.openRisk).toBeNull();
    for (const leg of d.legs) {
      expect(leg.notional).toBeNull();
      expect(leg.risk).toBeNull();
    }
  });

  it("nulls aggregates instead of showing partial sums", () => {
    const summary = aggregateExposure([
      decomposeTrade(jpyTrade(), "USD", USDJPY.contractSize),
    ]);
    expect(summary.missingFxSymbols).toEqual(["USDJPY"]);
    expect(summary.totalOpenRisk).toBeNull();
    for (const c of summary.byCurrency) {
      expect(c.notional).toBeNull();
      expect(c.risk).toBeNull();
    }
    for (const row of summary.byInstrument) {
      expect(row.risk).toBeNull();
      expect(row.notional).toBeNull();
    }
  });

  it("keeps a known trade's figures when mixed with an FX-missing trade", () => {
    const known = decomposeTrade(
      {
        id: "eur-usd",
        symbol: "EURUSD",
        direction: "LONG",
        lots: "1",
        entryPrice: "1.08",
        stopLoss: "1.07",
        accountCurrency: "USD",
      },
      "USD",
      EURUSD.contractSize
    );
    const summary = aggregateExposure([
      known,
      decomposeTrade(jpyTrade(), "USD", USDJPY.contractSize),
    ]);
    // The EUR leg stays known (it is not touched by the JPY trade)…
    const eur = summary.byCurrency.find((c) => c.currency === "EUR");
    expect(eur?.notional).not.toBeNull();
    // …but any aggregate the unknown trade touches is null.
    expect(summary.totalOpenRisk).toBeNull();
    const usd = summary.byCurrency.find((c) => c.currency === "USD");
    expect(usd?.notional).toBeNull();
  });

  it("keeps a server-supplied account-currency riskAmount known", () => {
    const d = decomposeTrade(
      jpyTrade({ riskAmount: "250" }),
      "USD",
      USDJPY.contractSize
    );
    expect(d.conversionMissing).toBe(true);
    expect(d.openRisk?.toString()).toBe("250");
    // Notionals are still unknown — only the risk was supplied.
    for (const leg of d.legs) {
      expect(leg.notional).toBeNull();
      expect(leg.risk).not.toBeNull();
    }
    expect(aggregateExposure([d]).totalOpenRisk?.toString()).toBe("250");
  });

  it("does not flag duplication for a currency with unknown notionals", () => {
    const summary = aggregateExposure([
      decomposeTrade(jpyTrade({ id: "a" }), "USD", USDJPY.contractSize),
      decomposeTrade(jpyTrade({ id: "b" }), "USD", USDJPY.contractSize),
    ]);
    expect(detectDuplication(summary, "1000000", DEFAULT_EXPOSURE_SETTINGS)).toEqual([]);
  });
});
