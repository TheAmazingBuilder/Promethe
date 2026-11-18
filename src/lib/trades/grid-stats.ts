/**
 * Trades grid view — pure helpers (no React, no DOM).
 *
 * The grid is a presentation mode over the same filtered trade list as the
 * table: same query, same rows, same filters. These helpers are unit-tested
 * in tests/unit/trades-grid.test.ts.
 */
import { Decimal } from "@/lib/trading/dec";
import type { CandleTimeframe } from "@/lib/validations/charts";
import { CANDLE_TIMEFRAMES } from "@/lib/validations/charts";

// ── View-mode persistence ────────────────────────────────────────────────────

export const GRID_VIEW_MODE_KEY = "promethe.trades.viewMode";

export type TradesViewMode = "table" | "grid" | "by-day";

export function parseGridViewMode(value: unknown): TradesViewMode {
  if (value === "grid") return "grid";
  if (value === "by-day") return "by-day";
  return "table";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/** Read the persisted Table/Grid/By-day mode. Defaults to "table" (existing view). */
export function readGridViewMode(
  storage: StorageLike | null = defaultStorage()
): TradesViewMode {
  try {
    return parseGridViewMode(storage?.getItem(GRID_VIEW_MODE_KEY));
  } catch {
    return "table";
  }
}

/** Persist the Table/Grid/By-day mode. Never throws (private mode, SSR, tests). */
export function writeGridViewMode(
  mode: TradesViewMode,
  storage: StorageLike | null = defaultStorage()
): void {
  try {
    storage?.setItem(GRID_VIEW_MODE_KEY, mode);
  } catch {
    // Persistence is a nicety, never a crash.
  }
}

// ── Header stats (whole filtered set, not just the current page) ─────────────

export interface GridStatTrade {
  resultType: string | null;
  netPnl: string | null;
  pnlCurrency: string;
}

export interface GridStats {
  /** Every trade in the filtered set (open, closed, drafts included). */
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** 0-100, one decimal. Null when no closed trade has a WIN or LOSS. */
  winRate: number | null;
  /** Decimal sum of netPnl over trades that have one, as a string. */
  netPnl: string;
  /** Most frequent pnl currency in the set ("USD" when the set is empty). */
  currency: string;
}

/**
 * Win rate counts WIN against WIN + LOSS only (breakevens and open trades
 * are excluded from the denominator, as in the analytics engine). Trades
 * without a netPnl contribute 0 to the sum, they are never invented.
 */
export function computeGridStats(trades: GridStatTrade[]): GridStats {
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let sum = new Decimal(0);
  const currencies = new Map<string, number>();
  for (const trade of trades) {
    if (trade.resultType === "WIN") wins += 1;
    else if (trade.resultType === "LOSS") losses += 1;
    else if (trade.resultType === "BREAKEVEN") breakevens += 1;
    if (trade.netPnl !== null && trade.netPnl !== undefined) {
      try {
        sum = sum.plus(new Decimal(trade.netPnl));
      } catch {
        // A malformed stored value contributes 0, it never breaks the page.
      }
    }
    if (trade.pnlCurrency) {
      currencies.set(
        trade.pnlCurrency,
        (currencies.get(trade.pnlCurrency) ?? 0) + 1
      );
    }
  }
  return gridStatsFromCounts({
    count: trades.length,
    wins,
    losses,
    breakevens,
    netPnl: sum.toString(),
    currencies,
  });
}

/**
 * Same math from pre-aggregated counts (Phase 2 perf — the server stats
 * endpoint aggregates in SQL instead of shipping every row). Currency is
 * the most frequent code; ties break alphabetically so the result is
 * deterministic (the row path breaks ties by first-seen order).
 */
export function gridStatsFromCounts(input: {
  count: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** Decimal sum as a string ("0" when the set is empty). */
  netPnl: string;
  currencies: Map<string, number>;
}): GridStats {
  const decided = input.wins + input.losses;
  let currency = "USD";
  let best = 0;
  const codes = [...input.currencies.keys()].sort();
  for (const code of codes) {
    const n = input.currencies.get(code) ?? 0;
    if (n > best) {
      best = n;
      currency = code;
    }
  }
  return {
    count: input.count,
    wins: input.wins,
    losses: input.losses,
    breakevens: input.breakevens,
    winRate:
      decided > 0 ? Math.round((input.wins / decided) * 1000) / 10 : null,
    netPnl: input.netPnl,
    currency,
  };
}

// ── Mini candlestick chart ───────────────────────────────────────────────────

/** Milliseconds per candle for every timeframe the candles API accepts. */
export const CANDLE_MS: Record<CandleTimeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

/**
 * The trade's own timeframe when the candles API accepts it (M1-D1),
 * otherwise H1. W1/MN trades fall back to H1: the API stores at most D1.
 */
export function resolveCandleTimeframe(
  tradeTimeframe: string | null | undefined
): CandleTimeframe {
  if (
    tradeTimeframe &&
    (CANDLE_TIMEFRAMES as readonly string[]).includes(tradeTimeframe)
  ) {
    return tradeTimeframe as CandleTimeframe;
  }
  return "H1";
}

/**
 * Candle window for one trade: 24 bars of context before entry, through the
 * exit (or 12 bars past entry for an open trade) plus 6 bars after. The
 * chart shows the trade in its own context, not a full history download.
 */
export function candleWindowForTrade(
  entryTime: string,
  exitTime: string | null | undefined,
  tradeTimeframe: string | null | undefined
): { timeframe: CandleTimeframe; from: string; to: string } {
  const timeframe = resolveCandleTimeframe(tradeTimeframe);
  const step = CANDLE_MS[timeframe];
  const entry = new Date(entryTime).getTime();
  const exit = exitTime ? new Date(exitTime).getTime() : entry;
  const from = new Date(entry - 24 * step).toISOString();
  const to = new Date(Math.max(exit, entry) + 6 * step).toISOString();
  return { timeframe, from, to };
}

// ── SVG candle layout (pure geometry, tested without a DOM) ──────────────────

export interface SvgCandleInput {
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SvgCandle {
  /** Candle body left edge (px). */
  x: number;
  /** Body width (px). */
  w: number;
  /** Wick x (px, body centre). */
  cx: number;
  yHigh: number;
  yLow: number;
  yOpen: number;
  yClose: number;
  up: boolean;
}

/**
 * Lay out up to `maxCandles` candles (most recent kept) in a width x height
 * box. Returns null when there is nothing drawable (empty list, flat or
 * invalid prices): the caller then shows the "No screenshot" placeholder
 * instead of an empty chart ground.
 */
export function layoutCandles(
  candles: SvgCandleInput[],
  width: number,
  height: number,
  maxCandles = 40
): SvgCandle[] | null {
  const slice = candles.slice(-maxCandles);
  if (slice.length === 0 || width <= 0 || height <= 0) return null;
  const parsed = slice.map((c) => ({
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));
  if (parsed.some((c) => [c.open, c.high, c.low, c.close].some((v) => !Number.isFinite(v)))) {
    return null;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const c of parsed) {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const pad = (max - min) * 0.08 || 1;
  const top = max + pad;
  const bottom = min - pad;
  const y = (v: number) => ((top - v) / (top - bottom)) * height;
  const slot = width / parsed.length;
  const bodyW = Math.max(1, Math.min(7, slot * 0.6));
  return parsed.map((c, i) => ({
    x: i * slot + (slot - bodyW) / 2,
    w: bodyW,
    cx: i * slot + slot / 2,
    yHigh: y(c.high),
    yLow: y(c.low),
    yOpen: y(c.open),
    yClose: y(c.close),
    up: c.close >= c.open,
  }));
}
