/**
 * Domain types for Gaia's built-in candlestick pattern library.
 * The catalog is code-owned: notes will persist only a stable pattern id.
 */
export const CANDLESTICK_PATTERN_CATEGORIES = [
  "indecision",
  "bullish-reversal",
  "bearish-reversal",
  "continuation",
] as const;

export type CandlestickPatternCategory =
  (typeof CANDLESTICK_PATTERN_CATEGORIES)[number];

export type CandlestickPatternBias = "bullish" | "bearish" | "neutral";

export interface CandlestickPattern {
  /** Stable identifier persisted by Gaia note blocks. */
  id: string;
  name: string;
  aliases: readonly string[];
  category: CandlestickPatternCategory;
  bias: CandlestickPatternBias;
  candles: 1 | 2 | 3;
  description: string;
  marketContext: string;
  interpretation: string;
  confirmation: string;
  caveats: string;
}

export interface CandlestickPatternSearchOptions {
  query?: string;
  category?: CandlestickPatternCategory | "all";
  bias?: CandlestickPatternBias | "all";
}
