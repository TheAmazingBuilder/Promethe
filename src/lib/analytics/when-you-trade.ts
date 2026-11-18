/**
 * When you trade (MRT wave 2) — pure computation over closed trades.
 *
 * Hour of day, day of week and session x weekday matrix, all from the
 * local ENTRY time (the trader's timezone, computed server-side — this
 * module stays timezone-agnostic and deterministic). Reuses the P6
 * seasonality convention: no verdict under a minimum sample, and every
 * cell carries its own sample size so the UI never overstates a thin
 * slice. Sessions are never invented: only values present in the data
 * appear, in `sessions` and in the matrix.
 *
 * Client-safe (no Prisma), money through decimal.js.
 */
import { D0, toD } from "@/lib/trading/dec";

/** Minimum trades in a slot before it can be called "best". */
export const MIN_SAMPLE_WHEN_YOU_TRADE = 5;

/** ISO weekday 1 (Monday) … 7 (Sunday). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Local entry hour 0 … 23. */
export const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Minimal trade shape — local entry parts, session, outcome. */
export interface WhenYouTradeTrade {
  /** ISO weekday of the local ENTRY, 1 (Monday) … 7 (Sunday). */
  localWeekday: number | null;
  /** Local ENTRY hour, 0 … 23. */
  localHour: number | null;
  /** Stored session code (ASIAN, LONDON, NEW_YORK, OVERLAP, OTHER, …). */
  session: string | null;
  netPnl: string | null;
  /** WIN | LOSS | BREAKEVEN. */
  resultType: string | null;
}

/** One aggregated slot (hour, weekday or matrix cell). */
export interface TimeCell {
  /** Stable key: hour ("9"), weekday ("2") or "SESSION|weekday". */
  key: string;
  count: number;
  wins: number;
  losses: number;
  /** Win rate 0-100 (1 decimal), null when no decided trade. */
  winRate: number | null;
  netPnl: string;
}

export interface HourCell extends TimeCell {
  hour: number;
}

export interface WeekdayCell extends TimeCell {
  weekday: number;
}

export interface MatrixCell extends TimeCell {
  session: string;
  weekday: number;
}

export interface WhenYouTradeResult {
  /** Trades that carried a usable local entry hour or weekday. */
  total: number;
  /** All 24 hours, 0 … 23 (empty hours included, count 0). */
  byHour: HourCell[];
  /** All 7 weekdays, Monday … Sunday (empty days included, count 0). */
  byWeekday: WeekdayCell[];
  /**
   * Sessions present in the data only, most traded first. Never a
   * hardcoded list: a session with zero trades never appears here.
   */
  sessions: string[];
  /** Session x weekday cells with at least one trade. */
  matrix: MatrixCell[];
  /** Best hour by net P&L among hours with at least MIN_SAMPLE trades. */
  bestHour: HourCell | null;
  /** Best weekday by net P&L among days with at least MIN_SAMPLE trades. */
  bestWeekday: WeekdayCell | null;
  minSample: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyCell(key: string): TimeCell {
  return {
    key,
    count: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    netPnl: D0.toString(),
  };
}

function addTrade(cell: TimeCell, trade: WhenYouTradeTrade): void {
  cell.count += 1;
  if (trade.resultType === "WIN") cell.wins += 1;
  if (trade.resultType === "LOSS") cell.losses += 1;
  cell.netPnl = toD(cell.netPnl).plus(toD(trade.netPnl ?? 0)).toString();
}

function finalize(cell: TimeCell): TimeCell {
  const decided = cell.wins + cell.losses;
  return {
    ...cell,
    winRate: decided > 0 ? round1((cell.wins / decided) * 100) : null,
  };
}

/** Known session codes first, custom session names after, alphabetically. */
const SESSION_RANK: Record<string, number> = {
  ASIAN: 1,
  LONDON: 2,
  OVERLAP: 3,
  NEW_YORK: 4,
  OTHER: 5,
};

function sessionRank(session: string): number {
  return SESSION_RANK[session] ?? 10;
}

/** Best cell by net P&L among cells with at least `minSample` trades. */
function pickBest<T extends TimeCell>(
  cells: T[],
  minSample: number
): T | null {
  let best: T | null = null;
  for (const cell of cells) {
    if (cell.count < minSample) continue;
    if (best == null || toD(cell.netPnl).gt(toD(best.netPnl))) best = cell;
  }
  return best;
}

export function computeWhenYouTrade(
  trades: WhenYouTradeTrade[]
): WhenYouTradeResult {
  const byHour = new Map<number, TimeCell>();
  const byWeekday = new Map<number, TimeCell>();
  const matrix = new Map<string, MatrixCell>();
  const sessionCounts = new Map<string, number>();

  for (const h of HOURS) byHour.set(h, emptyCell(String(h)));
  for (const d of WEEKDAYS) byWeekday.set(d, emptyCell(String(d)));

  let total = 0;
  for (const trade of trades) {
    const hour = trade.localHour;
    const weekday = trade.localWeekday;
    const hasHour = hour != null && hour >= 0 && hour <= 23;
    const hasWeekday = weekday != null && weekday >= 1 && weekday <= 7;
    if (!hasHour && !hasWeekday) continue;
    total += 1;
    if (hasHour) addTrade(byHour.get(hour)!, trade);
    if (hasWeekday) addTrade(byWeekday.get(weekday)!, trade);
    if (trade.session != null && trade.session !== "" && hasWeekday) {
      sessionCounts.set(
        trade.session,
        (sessionCounts.get(trade.session) ?? 0) + 1
      );
      const key = `${trade.session}|${weekday}`;
      const cell =
        matrix.get(key) ??
        ({ ...emptyCell(key), session: trade.session, weekday } as MatrixCell);
      addTrade(cell, trade);
      matrix.set(key, cell);
    }
  }

  const hours: HourCell[] = HOURS.map((h) => {
    const cell = finalize(byHour.get(h)!);
    return { ...cell, hour: h };
  });
  const weekdays: WeekdayCell[] = WEEKDAYS.map((d) => {
    const cell = finalize(byWeekday.get(d)!);
    return { ...cell, weekday: d };
  });
  const cells: MatrixCell[] = [...matrix.values()]
    .map((c) => finalize(c) as MatrixCell)
    .sort((a, b) => {
      const bySession = sessionRank(a.session) - sessionRank(b.session);
      if (bySession !== 0) return bySession;
      const byName = a.session.localeCompare(b.session);
      if (byName !== 0) return byName;
      return a.weekday - b.weekday;
    });

  const sessions = [...sessionCounts.entries()]
    .sort((a, b) => {
      const byCount = b[1] - a[1];
      if (byCount !== 0) return byCount;
      const byRank = sessionRank(a[0]) - sessionRank(b[0]);
      if (byRank !== 0) return byRank;
      return a[0].localeCompare(b[0]);
    })
    .map(([session]) => session);

  return {
    total,
    byHour: hours,
    byWeekday: weekdays,
    sessions,
    matrix: cells,
    bestHour: pickBest(hours, MIN_SAMPLE_WHEN_YOU_TRADE),
    bestWeekday: pickBest(weekdays, MIN_SAMPLE_WHEN_YOU_TRADE),
    minSample: MIN_SAMPLE_WHEN_YOU_TRADE,
  };
}
