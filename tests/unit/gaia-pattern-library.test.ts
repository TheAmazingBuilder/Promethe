import { describe, expect, it } from "vitest";
import { listCandlestickPatterns } from "@/lib/gaia/patterns/catalog";
import { getCandlestickPatternCandleCount } from "@/components/gaia/gaia-pattern-diagram";

describe("Gaia candlestick pattern diagrams", () => {
  it("provides a diagram with the expected number of candles for every catalog entry", () => {
    for (const pattern of listCandlestickPatterns()) {
      expect(getCandlestickPatternCandleCount(pattern.id), pattern.id).toBe(pattern.candles);
    }
  });

  it("does not resolve unknown pattern identifiers to a diagram", () => {
    expect(getCandlestickPatternCandleCount("../unknown")).toBe(0);
  });
});
