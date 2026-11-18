/**
 * Goal progression engine (v1 phase 6) — pure & client-safe.
 *
 * Measurable goals with dashboard progress (addendum §11.4). A goal targets
 * a METRIC (net P&L, win rate, average R, profit factor, trade count,
 * discipline score) over a rolling PERIOD (week / month / quarter / year /
 * all-time). Progress is computed against the CURRENT period instance in
 * the user's timezone — e.g. a MONTHLY goal evaluated on Nov 14 counts
 * trades closed from Nov 1 (or the goal's start date, if later) to now.
 *
 * Conventions (same as the analytics engine / calendar):
 * - Closed non-draft trades, P&L attributed to the TRADING day of the exit
 *   time (the same convention as the P&L calendar).
 * - Win = netPnl > 0, loss = netPnl < 0, breakeven otherwise.
 * - profitFactor: grossWin / |grossLoss|, "Infinity" when there are wins
 *   but no losses, null when there is no data at all.
 * - All metrics are "higher is better": achieved when current ≥ target.
 * - Every value is a decimal string at the boundary — never a float.
 */
import { toD, D0, type Decimal } from "@/lib/trading/dec";
import { weekdayIndex } from "@/lib/analytics/calendar";
import {
  DEFAULT_TRADING_DAY,
  getTradingDay,
  type TradingDaySettings,
} from "@/lib/time/trading-day";

export const GOAL_METRICS = [
  "NET_PNL",
  "WIN_RATE",
  "AVG_R",
  "PROFIT_FACTOR",
  "TRADE_COUNT",
  "DISCIPLINE_SCORE",
  // MRT wave 3 — Goals: win rate on A+ setups, plan-follow rate and
  // trades logged with a screenshot. All three are computed from the
  // trades themselves, never typed by hand.
  "A_PLUS_WIN_RATE",
  "PLAN_FOLLOW_RATE",
  "TRADES_WITH_SCREENSHOT",
] as const;

export const GOAL_PERIODS = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "ALL_TIME",
] as const;

export type GoalMetric = (typeof GOAL_METRICS)[number];
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export interface GoalDef {
  id: string;
  name: string;
  metric: GoalMetric;
  /** Positive decimal string (money, %, R, count… depending on the metric). */
  targetValue: string;
  period: GoalPeriod;
  /** Local calendar day the goal started on (YYYY-MM-DD). */
  startDate: string;
  /** Optional deadline (local day, inclusive). */
  endDate: string | null;
}

/** Closed trade as seen by the goal engine. */
export interface GoalTradePoint {
  exitIso: string;
  netPnl: string | null;
  rMultiple: string | null;
  /**
   * Setup grade (A+ | A | B | C) when the trade was graded. The grade
   * column lands with the parallel wave-3 grades chantier; until then
   * the server passes null and A_PLUS_WIN_RATE honestly reports "no
   * graded trades yet" instead of a misleading 0%.
   */
  grade?: string | null;
  /**
   * Playbook match (MATCHED | PARTIAL | OFF_PLAYBOOK) and the legacy
   * followedPlan flag. playbookMatch wins when present; followedPlan
   * is the fallback for trades recorded before the Playbook.
   */
  playbookMatch?: string | null;
  followedPlan?: boolean | null;
  /** True when at least one screenshot is attached to the trade. */
  hasScreenshot?: boolean;
}

/** Journal discipline score on a local day (1-5). */
export interface GoalDisciplinePoint {
  date: string; // YYYY-MM-DD (local)
  score: number;
}

export interface GoalProgress {
  goalId: string;
  /** Inclusive local start day of the current evaluation window. */
  windowStartDay: string;
  /** Exclusive local end day (day AFTER the last day of the window). */
  windowEndDay: string;
  /** Current metric value - null when the metric has no data yet. */
  currentValue: string | null;
  targetValue: string;
  /**
   * Eligible sample the metric was computed from inside the window:
   * window trades for most metrics, graded trades for A_PLUS_WIN_RATE,
   * trades with a plan verdict for PLAN_FOLLOW_RATE, journal days for
   * DISCIPLINE_SCORE. 0 means "nothing to measure yet" - the UI shows
   * an honest empty state instead of a 0% bar.
   */
  sampleSize: number;
  /** 0-100, clamped; 0 when there is no data. */
  progressPercent: number;
  isAchieved: boolean;
  /** True when the deadline passed without achieving the target. */
  isExpired: boolean;
}

// ── Window math (local days, user TZ) ────────────────────────────────────────

const FAR_FUTURE_DAY = "9999-12-31";

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function quarterStart(day: string): string {
  const y = day.slice(0, 4);
  const q = Math.floor((Number(day.slice(5, 7)) - 1) / 3); // 0-3
  return `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

function yearStart(day: string): string {
  return `${day.slice(0, 4)}-01-01`;
}

/**
 * Evaluation window for a goal, in trading days: [start, end). Rolling
 * periods anchor on the CURRENT week/month/quarter/year, then clamp to the
 * goal's own startDate / endDate. "Today" is the user's TRADING day
 * (default MIDNIGHT_LOCAL = the local calendar day, i.e. the previous
 * behaviour).
 */
export function goalWindow(
  goal: Pick<GoalDef, "period" | "startDate" | "endDate">,
  now: Date,
  timezone: string,
  tradingDay: TradingDaySettings = DEFAULT_TRADING_DAY
): { startDay: string; endDay: string; today: string } {
  const today = getTradingDay(now, timezone, tradingDay);

  let start: string;
  let end: string;
  switch (goal.period) {
    case "WEEKLY":
      start = addDays(today, -weekdayIndex(today));
      end = addDays(start, 7);
      break;
    case "MONTHLY":
      start = monthStart(today);
      end = nextMonthFirst(today);
      break;
    case "QUARTERLY": {
      start = quarterStart(today);
      // First day of the month following the quarter's last month.
      const [y, m] = start.split("-").map(Number);
      end =
        m + 3 > 12
          ? `${y + 1}-01-01`
          : `${y}-${String(m + 3).padStart(2, "0")}-01`;
      break;
    }
    case "YEARLY":
      start = yearStart(today);
      end = `${Number(today.slice(0, 4)) + 1}-01-01`;
      break;
    case "ALL_TIME":
      start = goal.startDate;
      end = FAR_FUTURE_DAY;
      break;
  }

  // Clamp to the goal's own bounds.
  if (goal.startDate > start) start = goal.startDate;
  if (goal.endDate != null) {
    const endInclusive = addDays(goal.endDate, 1);
    if (endInclusive < end) end = endInclusive;
  }
  // Degenerate window (goal not started yet, or already fully past).
  if (end <= start) end = start;

  return { startDay: start, endDay: end, today };
}

function nextMonthFirst(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// ── Metric computation ───────────────────────────────────────────────────────

function computeMetric(
  metric: GoalMetric,
  trades: GoalTradePoint[],
  discipline: GoalDisciplinePoint[]
): { value: string | null; sampleSize: number } {
  switch (metric) {
    case "NET_PNL": {
      let sum = D0;
      for (const t of trades) sum = sum.plus(toD(t.netPnl ?? 0));
      return { value: sum.toString(), sampleSize: trades.length };
    }
    case "TRADE_COUNT":
      return { value: String(trades.length), sampleSize: trades.length };
    case "WIN_RATE": {
      if (trades.length === 0) return { value: null, sampleSize: 0 };
      const wins = trades.filter((t) => toD(t.netPnl ?? 0).gt(0)).length;
      return {
        value: toD(wins).div(trades.length).times(100).toString(),
        sampleSize: trades.length,
      };
    }
    case "AVG_R": {
      const rs = trades
        .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
        .filter((r): r is Decimal => r !== null);
      if (rs.length === 0) return { value: null, sampleSize: 0 };
      let sum = D0;
      for (const r of rs) sum = sum.plus(r);
      return { value: sum.div(rs.length).toString(), sampleSize: rs.length };
    }
    case "PROFIT_FACTOR": {
      let grossWin = D0;
      let grossLoss = D0;
      for (const t of trades) {
        const pnl = toD(t.netPnl ?? 0);
        if (pnl.gt(0)) grossWin = grossWin.plus(pnl);
        else if (pnl.lt(0)) grossLoss = grossLoss.plus(pnl.abs());
      }
      if (grossWin.isZero() && grossLoss.isZero())
        return { value: null, sampleSize: 0 };
      if (grossLoss.isZero())
        return { value: "Infinity", sampleSize: trades.length };
      return {
        value: grossWin.div(grossLoss).toString(),
        sampleSize: trades.length,
      };
    }
    case "DISCIPLINE_SCORE": {
      if (discipline.length === 0) return { value: null, sampleSize: 0 };
      let sum = D0;
      for (const d of discipline) sum = sum.plus(d.score);
      return {
        value: sum.div(discipline.length).toString(),
        sampleSize: discipline.length,
      };
    }
    case "A_PLUS_WIN_RATE": {
      // Only graded trades count. Zero graded trades is "no data",
      // never a 0% win rate: the goal has nothing to measure yet.
      const graded = trades.filter((t) => t.grade === "A+");
      if (graded.length === 0) return { value: null, sampleSize: 0 };
      const wins = graded.filter((t) => toD(t.netPnl ?? 0).gt(0)).length;
      return {
        value: toD(wins).div(graded.length).times(100).toString(),
        sampleSize: graded.length,
      };
    }
    case "PLAN_FOLLOW_RATE": {
      // Eligible = the trade carries a plan verdict (playbookMatch, or
      // the legacy followedPlan flag). playbookMatch wins when present.
      const eligible = trades.filter(
        (t) => t.playbookMatch != null || t.followedPlan != null
      );
      if (eligible.length === 0) return { value: null, sampleSize: 0 };
      const followed = eligible.filter(
        (t) =>
          t.playbookMatch === "MATCHED" ||
          (t.playbookMatch == null && t.followedPlan === true)
      ).length;
      return {
        value: toD(followed).div(eligible.length).times(100).toString(),
        sampleSize: eligible.length,
      };
    }
    case "TRADES_WITH_SCREENSHOT": {
      const withShot = trades.filter((t) => t.hasScreenshot === true).length;
      return { value: String(withShot), sampleSize: trades.length };
    }
  }
}

/**
 * Full progression for one goal. Trades are filtered to the window by the
 * TRADING day of their exit time; discipline scores by their journal date
 * (journal entries are keyed by trading day, so the two stay aligned).
 */
export function computeGoalProgress(
  goal: GoalDef,
  trades: GoalTradePoint[],
  discipline: GoalDisciplinePoint[],
  now: Date,
  timezone: string,
  tradingDay: TradingDaySettings = DEFAULT_TRADING_DAY
): GoalProgress {
  const { startDay, endDay, today } = goalWindow(goal, now, timezone, tradingDay);

  const inWindow: GoalTradePoint[] = [];
  for (const t of trades) {
    const local = getTradingDay(new Date(t.exitIso), timezone, tradingDay);
    if (local >= startDay && local < endDay) inWindow.push(t);
  }
  const disciplineWindow = discipline.filter(
    (d) => d.date >= startDay && d.date < endDay
  );

  const { value: currentValue, sampleSize } = computeMetric(
    goal.metric,
    inWindow,
    disciplineWindow
  );
  const target = toD(goal.targetValue);
  const current = currentValue == null ? null : toD(currentValue);
  const isAchieved = current != null && current.gte(target) && target.gt(0);
  const progressPercent =
    current == null || !target.gt(0)
      ? 0
      : Math.min(
          100,
          Math.max(
            0,
            Number(current.div(target).times(100).toFixed(2))
          )
        );

  return {
    goalId: goal.id,
    windowStartDay: startDay,
    windowEndDay: endDay,
    currentValue,
    targetValue: target.toString(),
    sampleSize,
    progressPercent,
    isAchieved,
    isExpired:
      goal.endDate != null &&
      goal.endDate < today &&
      !isAchieved,
  };
}

/**
 * Deep link to the trades behind a goal, or null when there is nothing
 * to show (sample of 0). The trades list filters on ENTRY day while the
 * goal window is built on EXIT trading day, so the link covers the
 * trades entered in the window: exact for same-day trades, which is the
 * common case in this journal. dateTo is the window's exclusive end
 * day, which pairs with the server's `lte: new Date(dateTo)` (midnight)
 * to include the whole last day. No dateTo for all-time goals.
 */
export function goalDrilldownHref(
  progress: Pick<GoalProgress, "windowStartDay" | "windowEndDay" | "sampleSize">
): string | null {
  if (progress.sampleSize <= 0) return null;
  const params = new URLSearchParams({
    dateFrom: progress.windowStartDay,
  });
  if (progress.windowEndDay !== FAR_FUTURE_DAY) {
    params.set("dateTo", progress.windowEndDay);
  }
  return `/trades?${params.toString()}`;
}
