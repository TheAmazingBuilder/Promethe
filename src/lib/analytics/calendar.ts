/**
 * TradeJournal — calendar & PROP risk engine (v1 phase 5).
 *
 * Pure, client-safe (no Prisma): month grid math, per-day aggregation
 * summaries, day-streaks and PROP-challenge breach computation. All money in
 * decimal.js — strings at the boundaries, exactly like the analytics engine.
 *
 * Documented conventions:
 *  - Calendar weeks start on MONDAY (fr-CA convention).
 *  - A "trading day" is a local day with at least one closed trade.
 *  - PROP daily loss limit  = maxDailyLossPercent × initialBalance (firm
 *    convention: % of the initial balance, not of the running equity).
 *  - PROP total drawdown (STATIC)   = initialBalance − currentEquity.
 *  - PROP total drawdown (TRAILING) = peakEquity − currentEquity (high-water
 *    mark since startDate), limit still expressed as % of initialBalance.
 *  - Profit target is an AMOUNT in the account currency (progress from the
 *    initial balance).
 *  - WARNING when ≥ 75 % of a limit is consumed, BREACHED at ≥ 100 %.
 */
import { D0, Decimal, toD, type DecimalInput } from "@/lib/trading/dec";

// ── Month grid ───────────────────────────────────────────────────────────────

export interface GridCell {
  /** ISO date YYYY-MM-DD (in-month cells only are marked inMonth). */
  date: string;
  inMonth: boolean;
  /** Week number (1-based) within the returned grid. */
  week: number;
}

/** Days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Monday-first grid covering the whole month (4-6 rows). Leading cells belong
 * to the previous month, trailing ones to the next.
 */
export function buildMonthGrid(year: number, month: number): GridCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // Monday=0 … Sunday=6 (getUTCDay: Sunday=0)
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  const total = daysInMonth(year, month);
  const cells: GridCell[] = [];

  // Leading days from the previous month.
  for (let i = firstWeekday; i > 0; i--) {
    const d = new Date(Date.UTC(year, month - 1, 1 - i));
    cells.push({
      date: isoDay(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate()
      ),
      inMonth: false,
      week: 0,
    });
  }
  // In-month days.
  for (let d = 1; d <= total; d++) {
    cells.push({ date: isoDay(year, month, d), inMonth: true, week: 0 });
  }
  // Trailing days to complete the last week (always full weeks).
  let next = 1;
  const trailingFrom = new Date(Date.UTC(year, month, 1));
  while (cells.length % 7 !== 0) {
    cells.push({
      date: isoDay(
        trailingFrom.getUTCFullYear(),
        trailingFrom.getUTCMonth() + 1,
        next
      ),
      inMonth: false,
      week: 0,
    });
    next++;
  }
  // Week numbers.
  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7).map((c, j) => ({ ...c, week: i / 7 + 1 }));
    weeks.push(week);
  }
  return weeks;
}

// ── Day aggregation & streaks ───────────────────────────────────────────────

export interface CalendarDay {
  /** ISO date YYYY-MM-DD in the user's timezone. */
  date: string;
  netPnl: string;
  tradeCount: number;
  wins: number;
  losses: number;
  /** Sum of R multiples over R-trades (null when none has an R). */
  totalR: string | null;
  hasJournal: boolean;
}

export interface MonthSummary {
  netPnl: string;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  bestDay: { date: string; netPnl: string } | null;
  worstDay: { date: string; netPnl: string } | null;
  /** % of green days among trading days (null when no trading day). */
  greenRate: string | null;
}

export interface DayStreaks {
  /** +n winning / −n losing streak ending at the most recent trading day. */
  current: number;
  longestWin: number;
  longestLoss: number;
}

export function computeMonthSummary(days: CalendarDay[]): MonthSummary {
  const trading = days.filter((d) => d.tradeCount > 0);
  const pnls = trading.map((d) => toD(d.netPnl));
  const green = pnls.filter((p) => p.gt(0));
  const red = pnls.filter((p) => p.lt(0));
  let best: CalendarDay | null = null;
  let worst: CalendarDay | null = null;
  for (const d of trading) {
    const p = toD(d.netPnl);
    if (!best || p.gt(toD(best.netPnl))) best = d;
    if (!worst || p.lt(toD(worst.netPnl))) worst = d;
  }
  return {
    netPnl: pnls.reduce((acc, p) => acc.plus(p), D0).toString(),
    tradingDays: trading.length,
    greenDays: green.length,
    redDays: red.length,
    bestDay: best ? { date: best.date, netPnl: best.netPnl } : null,
    worstDay: worst ? { date: worst.date, netPnl: worst.netPnl } : null,
    greenRate:
      trading.length === 0
        ? null
        : new Decimal(green.length)
            .div(trading.length)
            .times(100)
            .toString(),
  };
}

/**
 * Streaks over consecutive TRADING days (non-trading days do not break a
 * streak). Input order is irrelevant — days are sorted chronologically.
 */
export function computeDayStreaks(days: CalendarDay[]): DayStreaks {
  const trading = days
    .filter((d) => d.tradeCount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let current = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let run = 0; // +n win streak, −n loss streak, 0 flat
  for (const d of trading) {
    const p = toD(d.netPnl);
    if (p.gt(0)) run = run >= 0 ? run + 1 : 1;
    else if (p.lt(0)) run = run <= 0 ? run - 1 : -1;
    else run = 0; // flat day resets
    if (run > 0) longestWin = Math.max(longestWin, run);
    if (run < 0) longestLoss = Math.max(longestLoss, -run);
  }
  current = run;
  return { current, longestWin, longestLoss };
}

// ── PROP challenge status ───────────────────────────────────────────────────

export type PropLimitStatus = "OK" | "WARNING" | "BREACHED";

/** ≥ this fraction of a limit consumed → WARNING. */
export const PROP_WARNING_THRESHOLD = 0.75;

export interface PropLimit {
  /** Configured limit amount in account currency (null = not configured). */
  limitAmount: string | null;
  /** Amount consumed so far (≥ 0). */
  used: string;
  /** % of the limit consumed — can exceed 100 on breach (null: no limit). */
  usedPercent: string | null;
  /** Amount left before breach — negative once breached (null: no limit). */
  remaining: string | null;
  status: PropLimitStatus;
}

export interface PropTargetProgress {
  /** Configured target amount (null = not configured). */
  targetAmount: string | null;
  /** Gained since the initial balance. */
  gained: string;
  /** 0-100 progress toward the target (null: no target). */
  progressPercent: string | null;
  /** Amount left to reach the target (negative once reached). */
  remaining: string | null;
  reached: boolean;
}

export interface PropStatus {
  initialBalance: string;
  currentEquity: string;
  /** High-water mark since startDate (closed-P&L basis). */
  peakEquity: string;
  /** Local-day closed P&L so far. */
  todayPnl: string;
  /** Equity at local-day start (currentEquity − todayPnl). */
  todayStartEquity: string;
  drawdownType: "STATIC" | "TRAILING";
  dailyLoss: PropLimit;
  totalDrawdown: PropLimit;
  profitTarget: PropTargetProgress;
  overall: PropLimitStatus;
  breached: boolean;
}

export interface PropStatusInput {
  initialBalance: DecimalInput;
  /** initialBalance + closed P&L since startDate. */
  currentEquity: DecimalInput;
  /** Running peak of the equity curve since startDate. */
  peakEquity: DecimalInput;
  /** Closed P&L of the current local day (negative when losing). */
  todayPnl: DecimalInput;
  maxDailyLossPercent: DecimalInput | null;
  maxTotalDrawdownPercent: DecimalInput | null;
  profitTarget: DecimalInput | null;
  drawdownType: "STATIC" | "TRAILING" | null;
}

function limitOf(
  used: Decimal,
  limitAmount: Decimal | null
): PropLimit {
  if (limitAmount == null) {
    return {
      limitAmount: null,
      used: used.toString(),
      usedPercent: null,
      remaining: null,
      status: "OK",
    };
  }
  const usedPercent = limitAmount.isZero()
    ? used.gt(0)
      ? new Decimal(Infinity)
      : D0
    : used.div(limitAmount).times(100);
  const status: PropLimitStatus = used.gte(limitAmount)
    ? "BREACHED"
    : usedPercent.gte(new Decimal(PROP_WARNING_THRESHOLD).times(100))
      ? "WARNING"
      : "OK";
  return {
    limitAmount: limitAmount.toString(),
    used: used.toString(),
    usedPercent: usedPercent.toString(),
    remaining: limitAmount.minus(used).toString(),
    status,
  };
}

export function computePropStatus(input: PropStatusInput): PropStatus {
  const initial = toD(input.initialBalance);
  const equity = toD(input.currentEquity);
  const peak = toD(input.peakEquity);
  const todayPnl = toD(input.todayPnl);

  // Daily loss: consumed = max(0, −todayPnl); limit = % of initial balance.
  const dailyUsed = todayPnl.lt(0) ? todayPnl.neg() : D0;
  const dailyLimit =
    input.maxDailyLossPercent == null
      ? null
      : toD(input.maxDailyLossPercent).div(100).times(initial);

  // Total drawdown: static from initial, trailing from the running peak.
  const drawdownType = input.drawdownType ?? "STATIC";
  const ddBase = drawdownType === "TRAILING" ? peak : initial;
  const ddUsed = equity.lt(ddBase) ? ddBase.minus(equity) : D0;
  const ddLimit =
    input.maxTotalDrawdownPercent == null
      ? null
      : toD(input.maxTotalDrawdownPercent).div(100).times(initial);

  // Profit target: absolute progress from the initial balance.
  const gained = equity.minus(initial).gt(0) ? equity.minus(initial) : D0;
  const target =
    input.profitTarget == null ? null : toD(input.profitTarget);
  const progressPercent =
    target == null || target.isZero()
      ? null
      : gained.div(target).times(100).toString();
  const profitTarget: PropTargetProgress = {
    targetAmount: target?.toString() ?? null,
    gained: gained.toString(),
    progressPercent,
    remaining: target == null ? null : target.minus(gained).toString(),
    reached: target != null && gained.gte(target),
  };

  const dailyLoss = limitOf(dailyUsed, dailyLimit);
  const totalDrawdown = limitOf(ddUsed, ddLimit);
  const overall: PropLimitStatus =
    dailyLoss.status === "BREACHED" || totalDrawdown.status === "BREACHED"
      ? "BREACHED"
      : dailyLoss.status === "WARNING" || totalDrawdown.status === "WARNING"
        ? "WARNING"
        : "OK";

  return {
    initialBalance: initial.toString(),
    currentEquity: equity.toString(),
    peakEquity: peak.toString(),
    todayPnl: todayPnl.toString(),
    todayStartEquity: equity.minus(todayPnl).toString(),
    drawdownType,
    dailyLoss,
    totalDrawdown,
    profitTarget,
    overall,
    breached: overall === "BREACHED",
  };
}

// ── Local dates (timezone) ───────────────────────────────────────────────────

/** ISO date (YYYY-MM-DD) of `date` in `timezone` — null on invalid TZ. */
export function localDateInTz(date: Date, timezone: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return null;
  }
}

/** First and last ISO dates of a calendar month. */
export function monthBounds(year: number, month: number): {
  first: string;
  last: string;
} {
  return {
    first: isoDay(year, month, 1),
    last: isoDay(year, month, daysInMonth(year, month)),
  };
}

/** "YYYY-MM-DD" → weekday label key index (0=Monday … 6=Sunday). */
export function weekdayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Compares two ISO dates lexicographically (works for YYYY-MM-DD). */
export function isoDayBetween(
  day: string,
  first: string,
  last: string
): boolean {
  return day >= first && day <= last;
}
