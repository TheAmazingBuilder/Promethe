/**
 * TradeJournal — analytics engine (v2).
 *
 * Pure KPI computation over CLOSED trades. Client-safe (no Prisma), all money
 * and R multiples parsed through decimal.js. Consumed by the dashboard, the
 * (future) analytics view, reports and comparison/simulation phases — the
 * engine is intentionally free of presentation concerns.
 */
import { D0, Decimal, toD, type DecimalInput } from "@/lib/trading/dec";

/** Minimal closed-trade summary - everything the engine needs. */
export interface StatTrade {
  id: string;
  /** ISO date - exit for P&L attribution, entry for entry-time breakdowns. */
  exitTime: string;
  entryTime: string;
  netPnl: string | null;
  rMultiple: string | null;
  resultType: string | null; // WIN | LOSS | BREAKEVEN
  strategyId: string | null;
  strategyName?: string | null;
  instrumentId: string;
  symbol: string;
  direction: string;
  session: string | null;
  lots: string | null;
}

export interface EquityPoint {
  /** Trade sequence (1-based). */
  i: number;
  /** ISO exit date. */
  date: string;
  /** Cumulative balance (initialBalance + netPnl so far). */
  equity: string;
  /** Cumulative net P&L. */
  cumPnl: string;
  /** Drawdown from the running peak (absolute, ≥ 0). */
  drawdown: string;
}

export interface TradeStats {
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** 0-100. */
  winRate: string | null;
  netPnl: string;
  grossWin: string;
  grossLoss: string;
  /** grossWin / |grossLoss| - null when no loss. */
  profitFactor: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  maxWin: string | null;
  maxLoss: string | null;
  /** Average R multiple over trades that have one. */
  avgR: string | null;
  expectancyR: string | null;
  /** Sum of R over R-trades (system quality proxy). */
  totalR: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  /** Longest win / loss streaks (by resultType). */
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  /** Days with at least one closed trade. */
  tradingDays: number;
}

export interface GroupStat<K extends string = string> {
  key: K;
  stats: TradeStats;
}

/**
 * Day attribution for day-bucketed outputs (tradingDays, dailyPnl).
 * Default: the UTC calendar date of the exit (`exitTime.slice(0, 10)`) —
 * the historical behaviour, preserved exactly for every existing caller.
 * Server callers pass `tradingDayOfTrade(timezone, settings)` so the
 * buckets follow the user's trading-day definition (v2.5 Module 8).
 */
export interface DayKeyOptions {
  dayOf?: (t: StatTrade) => string;
}

const defaultDayOf = (t: StatTrade): string => t.exitTime.slice(0, 10);

function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), D0);
}

/** Chronological (exit-time ascending, stable) - REQUIRED for equity/drawdown. */
export function sortChronologically<T extends StatTrade>(trades: T[]): T[] {
  return [...trades].sort(
    (a, b) =>
      new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime() ||
      a.id.localeCompare(b.id)
  );
}

export function computeEquityCurve(
  trades: StatTrade[],
  initialBalance: DecimalInput
): EquityPoint[] {
  let equity = toD(initialBalance);
  let peak = equity;
  let cum = D0;
  return sortChronologically(trades).map((t, idx) => {
    cum = cum.plus(toD(t.netPnl ?? 0));
    equity = toD(initialBalance).plus(cum);
    if (equity.gt(peak)) peak = equity;
    const dd = peak.minus(equity);
    return {
      i: idx + 1,
      date: t.exitTime,
      equity: equity.toString(),
      cumPnl: cum.toString(),
      drawdown: dd.lt(0) ? D0.toString() : dd.toString(),
    };
  });
}

export function computeTradeStats(
  trades: StatTrade[],
  options?: DayKeyOptions
): TradeStats {
  const ordered = sortChronologically(trades);
  const dayOf = options?.dayOf ?? defaultDayOf;
  const pnls = ordered.map((t) => toD(t.netPnl ?? 0));
  const rs = ordered
    .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
    .filter((r): r is Decimal => r !== null);

  const wins = pnls.filter((p) => p.gt(0));
  const losses = pnls.filter((p) => p.lt(0));
  const breakevens = pnls.length - wins.length - losses.length;

  const grossWin = sum(wins);
  const grossLoss = sum(losses).abs();

  // Streaks (WIN/LOSS, breakeven keeps the current streak going).
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let cur = 0;
  for (const t of ordered) {
    if (t.resultType === "WIN") {
      cur = cur >= 0 ? cur + 1 : 1;
      maxWinStreak = Math.max(maxWinStreak, cur);
    } else if (t.resultType === "LOSS") {
      cur = cur <= 0 ? cur - 1 : -1;
      maxLossStreak = Math.max(maxLossStreak, -cur);
    }
    // BREAKEVEN: streak unchanged
  }
  const currentStreak = cur;

  // Max drawdown from the cumulative P&L curve.
  let cum = D0;
  let peak = D0;
  let maxDd = D0;
  let maxDdPct: Decimal | null = null;
  for (const p of pnls) {
    cum = cum.plus(p);
    if (cum.gt(peak)) peak = cum;
    const dd = peak.minus(cum);
    if (dd.gt(maxDd)) {
      maxDd = dd;
      // % of the peak cumulative level (meaningful once the curve is net
      // positive; null otherwise — callers with a balance use the equity curve).
      maxDdPct = peak.gt(0) ? dd.div(peak).times(100) : null;
    }
  }

  const days = new Set(ordered.map((t) => dayOf(t)));

  const avg = (arr: Decimal[]): string | null =>
    arr.length === 0 ? null : sum(arr).div(arr.length).toString();

  return {
    tradeCount: ordered.length,
    wins: wins.length,
    losses: losses.length,
    breakevens,
    winRate:
      ordered.length === 0
        ? null
        : new Decimal(wins.length)
            .div(ordered.length)
            .times(100)
            .toString(),
    netPnl: sum(pnls).toString(),
    grossWin: grossWin.toString(),
    grossLoss: grossLoss.toString(),
    profitFactor:
      grossLoss.isZero() && grossWin.isZero()
        ? null
        : grossLoss.isZero()
          ? "Infinity"
          : grossWin.div(grossLoss).toString(),
    avgWin: avg(wins),
    avgLoss: avg(losses.map((l) => l.abs())),
    maxWin: wins.length === 0 ? null : wins.reduce((m, v) => (v.gt(m) ? v : m)).toString(),
    maxLoss:
      losses.length === 0
        ? null
        : losses.reduce((m, v) => (v.lt(m) ? v : m)).toString(),
    avgR: avg(rs),
    expectancyR:
      rs.length === 0 ? null : sum(rs).div(rs.length).toString(),
    totalR: rs.length === 0 ? null : sum(rs).toString(),
    maxDrawdown: maxDd.toString(),
    maxDrawdownPercent: maxDdPct?.toString() ?? null,
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    tradingDays: days.size,
  };
}

/** Group stats by a string key (strategy, symbol, session, direction…). */
export function groupStats<T extends StatTrade>(
  trades: T[],
  keyOf: (t: T) => string | null | undefined
): GroupStat[] {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    const key = keyOf(t);
    if (key == null || key === "") continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, stats: computeTradeStats(list) }))
    .sort((a, b) => toD(b.stats.netPnl).cmp(toD(a.stats.netPnl)));
}

/** Daily net P&L list (ISO date → sum) - calendar view (v1 phase 5).
 * The date is the TRADING day when `options.dayOf` is provided, the UTC
 * exit date otherwise (historical default, unchanged). */
export function dailyPnl(
  trades: StatTrade[],
  options?: DayKeyOptions
): Array<{ date: string; netPnl: string; count: number }> {
  const dayOf = options?.dayOf ?? defaultDayOf;
  const map = new Map<string, { pnl: Decimal; count: number }>();
  for (const t of trades) {
    const day = dayOf(t);
    const prev = map.get(day) ?? { pnl: D0, count: 0 };
    map.set(day, {
      pnl: prev.pnl.plus(toD(t.netPnl ?? 0)),
      count: prev.count + 1,
    });
  }
  return [...map.entries()]
    .map(([date, v]) => ({ date, netPnl: v.pnl.toString(), count: v.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
