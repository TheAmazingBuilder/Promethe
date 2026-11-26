/**
 * Gaia - shared candlestick pattern diagram.
 *
 * Single source of truth for pattern illustrations: the diagram is derived
 * from the pattern id (candle shapes), never from a stored URL or image.
 * Used by the pattern library panel, the block renderer and the print
 * sheet, so the same pattern always draws the same way - including
 * offline, where no static asset is fetched.
 */
import * as React from "react";

type CandleShape = {
  high: number;
  open: number;
  close: number;
  low: number;
  bullish: boolean;
};

const CANDLE_SHAPES: Record<string, CandleShape[]> = {
  doji: [{ high: 8, open: 29, close: 30, low: 52, bullish: true }],
  "long-legged-doji": [{ high: 5, open: 29, close: 30, low: 55, bullish: true }],
  "dragonfly-doji": [{ high: 8, open: 12, close: 12, low: 55, bullish: true }],
  "gravestone-doji": [{ high: 5, open: 49, close: 49, low: 52, bullish: false }],
  hammer: [{ high: 18, open: 22, close: 30, low: 55, bullish: true }],
  "hanging-man": [{ high: 18, open: 22, close: 30, low: 55, bullish: false }],
  "inverted-hammer": [{ high: 5, open: 34, close: 42, low: 48, bullish: true }],
  "shooting-star": [{ high: 5, open: 34, close: 42, low: 48, bullish: false }],
  "bullish-engulfing": [
    { high: 13, open: 20, close: 38, low: 46, bullish: false },
    { high: 8, open: 43, close: 15, low: 51, bullish: true },
  ],
  "bearish-engulfing": [
    { high: 8, open: 38, close: 17, low: 45, bullish: true },
    { high: 12, open: 13, close: 43, low: 52, bullish: false },
  ],
  "piercing-line": [
    { high: 10, open: 17, close: 40, low: 49, bullish: false },
    { high: 12, open: 43, close: 24, low: 50, bullish: true },
  ],
  "dark-cloud-cover": [
    { high: 8, open: 40, close: 17, low: 48, bullish: true },
    { high: 11, open: 14, close: 35, low: 51, bullish: false },
  ],
  "morning-star": [
    { high: 9, open: 15, close: 42, low: 50, bullish: false },
    { high: 25, open: 30, close: 32, low: 39, bullish: false },
    { high: 13, open: 42, close: 16, low: 50, bullish: true },
  ],
  "evening-star": [
    { high: 8, open: 42, close: 16, low: 49, bullish: true },
    { high: 22, open: 30, close: 32, low: 39, bullish: true },
    { high: 12, open: 16, close: 43, low: 51, bullish: false },
  ],
  "three-white-soldiers": [
    { high: 13, open: 42, close: 25, low: 50, bullish: true },
    { high: 9, open: 34, close: 17, low: 43, bullish: true },
    { high: 5, open: 26, close: 10, low: 35, bullish: true },
  ],
  "three-black-crows": [
    { high: 9, open: 17, close: 35, low: 43, bullish: false },
    { high: 16, open: 25, close: 43, low: 51, bullish: false },
    { high: 24, open: 34, close: 52, low: 58, bullish: false },
  ],
};

export function getCandlestickPatternCandleCount(patternId: string): number {
  return CANDLE_SHAPES[patternId]?.length ?? 0;
}

export function PatternGlyph({
  patternId,
  compact = false,
}: {
  patternId: string;
  compact?: boolean;
}) {
  const candles = CANDLE_SHAPES[patternId] ?? [];
  const width = compact ? 112 : 176;
  const height = compact ? 62 : 82;
  const spacing = width / (candles.length + 1);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className={compact ? "h-14 w-full" : "h-20 w-full"}
      role="presentation"
    >
      <line x1="4" y1={height - 5} x2={width - 4} y2={height - 5} stroke="currentColor" opacity=".12" />
      {candles.map((candle, index) => {
        const x = spacing * (index + 1);
        const top = Math.min(candle.open, candle.close);
        const bodyHeight = Math.max(3, Math.abs(candle.close - candle.open));
        const color = candle.bullish ? "#10b981" : "#f43f5e";
        return (
          <g key={index} stroke={color} strokeWidth="2" strokeLinecap="round">
            <line x1={x} y1={candle.high} x2={x} y2={candle.low} />
            <rect
              x={x - (compact ? 5 : 7)}
              y={top}
              width={compact ? 10 : 14}
              height={bodyHeight}
              rx="1"
              fill={color}
              stroke={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
