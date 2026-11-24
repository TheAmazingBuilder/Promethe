import { describe, expect, it } from "vitest";
import {
  aggregateExposure,
  decomposeTrade,
  detectDuplication,
  type OpenTradeLike,
} from "@/lib/tools/exposure";
import { DEFAULT_EXPOSURE_SETTINGS } from "@/lib/tools/types";
import { findPreset } from "@/lib/trading/instruments";

const EURUSD = findPreset("EURUSD")!;

function openTrade(id: string, direction: "LONG" | "SHORT"): OpenTradeLike {
  return {
    id,
    symbol: "EURUSD",
    direction,
    lots: "1",
    entryPrice: "1.08",
    stopLoss: "1.07",
    accountCurrency: "USD",
  };
}

describe("currency exposure duplication", () => {
  it("does not call one long and one short position a same-direction duplicate", () => {
    const summary = aggregateExposure([
      decomposeTrade(openTrade("long", "LONG"), "USD", EURUSD.contractSize),
      decomposeTrade(openTrade("short", "SHORT"), "USD", EURUSD.contractSize),
    ]);

    const eur = summary.byCurrency.find((currency) => currency.currency === "EUR");
    expect(eur?.positionCount).toBe(2);
    expect(eur?.longPositionCount).toBe(1);
    expect(eur?.shortPositionCount).toBe(1);
    expect(detectDuplication(summary, "1000000", DEFAULT_EXPOSURE_SETTINGS)).toEqual([]);
  });

  it("flags two same-direction positions independently for each currency leg", () => {
    const summary = aggregateExposure([
      decomposeTrade(openTrade("long-1", "LONG"), "USD", EURUSD.contractSize),
      decomposeTrade(openTrade("long-2", "LONG"), "USD", EURUSD.contractSize),
    ]);

    const alerts = detectDuplication(summary, "1000000", DEFAULT_EXPOSURE_SETTINGS);
    expect(alerts).toHaveLength(2);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "EUR", direction: "LONG", positionCount: 2 }),
        expect.objectContaining({ currency: "USD", direction: "SHORT", positionCount: 2 }),
      ])
    );
  });
});
