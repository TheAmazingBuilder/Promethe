/**
 * Prop Firm challenge engine (Lot 5) — pure, deterministic evaluation of a
 * challenge phase against closed trades, balance operations and the equity
 * data available. No database, no I/O: the server loads the rows and this
 * module decides.
 *
 * Source of truth: the challenge's frozen rules snapshot (one phase rule at
 * a time) plus the timezone and reset time frozen on the challenge itself.
 * Rules of one challenge never see another challenge's trades.
 *
 * Conventions (see docs/financial-conventions.md, section 8):
 * - A firm day is the challenge's own day: it ends at resetTimeLocal in the
 *   challenge timezone (DST-safe through Intl). A trade belongs to the firm
 *   day its exit instant falls in.
 * - Cash flows (deposits/withdrawals) change the real balance but are never
 *   P&L: daily loss, profit target and drawdown all run on the
 *   cash-flow-adjusted equity (starting balance + closed P&L only).
 * - Drawdown: STATIC / BALANCE_BASED measures from the phase starting
 *   balance on the adjusted series; TRAILING / EQUITY_BASED measures from
 *   the running peak of the adjusted series.
 * - Equity snapshots (EA heartbeats, sparse) add intraday points to the
 *   adjusted series. Without any snapshot in the phase, equity equals the
 *   closed-trade balance and open positions plus intraday moves are
 *   invisible - the result says so instead of inventing values.
 * - Severity: WARNING at 75% of a limit, IMMINENT at 95%, BREACH at 100%.
 *   A breach is recorded the moment it happens, even if the account
 *   recovers afterwards.
 */
import { Decimal } from "decimal.js";
import { toD, type DecimalInput } from "@/lib/trading/dec";
import { getTradingDay } from "@/lib/time/trading-day";
import {
  PROP_IMMINENT_THRESHOLD,
  PROP_WARNING_THRESHOLD,
} from "@/lib/analytics/calendar";
import type { PropPhaseRuleInput } from "@/lib/validations/prop-firms";

export type PropRuleId =
  | "DAILY_LOSS"
  | "TOTAL_DRAWDOWN"
  | "PROFIT_TARGET"
  | "MIN_TRADING_DAYS"
  | "MAX_TRADING_DAYS"
  | "CONSISTENCY"
  | "WEEKEND_HOLDING"
  | "NEWS_TRADING"
  | "LEVERAGE";

export type PropRuleStatus =
  | "PASS"
  | "WARNING"
  | "IMMINENT"
  | "BREACH"
  | "PENDING"
  | "SKIPPED"
  | "UNKNOWN";

export interface PropEngineTrade {
  entryTime: Date;
  /** null = still open (no realized P&L yet). */
  exitTime: Date | null;
  netPnl: DecimalInput | null;
}

export interface PropEngineCashFlow {
  date: Date;
  /** Signed: + deposit/bonus, - withdrawal. */
  amount: DecimalInput;
}

export interface PropEngineEquityPoint {
  time: Date;
  /** Real account equity at that instant (open positions included). */
  equity: DecimalInput;
}

export interface PropEngineInput {
  phaseStartingBalance: DecimalInput;
  rule: PropPhaseRuleInput;
  timezone: string;
  /** "HH:MM" local reset time in the challenge timezone. */
  resetTimeLocal: string;
  /** Closed trades of this account in this phase (exit >= phase start). */
  trades: PropEngineTrade[];
  /** Balance operations of this account in this phase. */
  cashFlows: PropEngineCashFlow[];
  /** Equity snapshots of this account in this phase (may be empty). */
  equityPoints: PropEngineEquityPoint[];
  phaseStart: Date;
  now: Date;
}

export interface PropRuleEvaluation {
  rule: PropRuleId;
  status: PropRuleStatus;
  /** Plain-English explanation of why the rule passes, warns or breaches. */
  detail: string;
  used: string | null;
  limit: string | null;
  usedPercent: string | null;
  remaining: string | null;
}

export interface PropEvaluationDay {
  day: string;
  trades: number;
  netPnl: string;
  /** Adjusted equity at the end of the firm day. */
  equity: string;
  /** Drawdown at the end of the firm day (0 when at or above the base). */
  drawdown: string;
  isTradingDay: boolean;
}

export type PropPhaseOutcomeKind = "PASSED" | "FAILED" | "IN_PROGRESS";

export interface PropPhaseOutcome {
  outcome: PropPhaseOutcomeKind;
  failReason:
    | "MAX_DAILY_LOSS"
    | "MAX_DRAWDOWN"
    | "TIME_LIMIT"
    | "RULE_VIOLATION"
    | "OTHER"
    | null;
  failRule: PropRuleId | null;
  recommendedAction: "NONE" | "MARK_PHASE_PASSED" | "MARK_PHASE_FAILED";
  reasons: string[];
}

export interface PropEngineResult {
  currentBalance: string;
  /** Cash-flow-adjusted equity now (starting balance + closed P&L). */
  currentEquity: string;
  peakEquity: string;
  todayPnl: string;
  todayDayKey: string;
  tradingDays: number;
  /** SNAPSHOTS when at least one snapshot exists in the phase. */
  equityData: "SNAPSHOTS" | "CLOSED_ONLY";
  equityDataNote: string | null;
  /** True when the timezone or reset time was invalid and UTC was used. */
  timezoneFallback: boolean;
  rules: PropRuleEvaluation[];
  phaseOutcome: PropPhaseOutcome;
  days: PropEvaluationDay[];
}

const D0 = new Decimal(0);

function limitStatus(used: Decimal, limit: Decimal | null): PropRuleStatus {
  if (limit == null) return "SKIPPED";
  if (limit.isZero()) return used.gt(0) ? "BREACH" : "PASS";
  if (used.gte(limit)) return "BREACH";
  const fraction = used.div(limit);
  if (fraction.gte(new Decimal(PROP_IMMINENT_THRESHOLD))) return "IMMINENT";
  if (fraction.gte(new Decimal(PROP_WARNING_THRESHOLD))) return "WARNING";
  return "PASS";
}

function pct(used: Decimal, limit: Decimal | null): string | null {
  if (limit == null || limit.isZero()) return null;
  return used.div(limit).times(100).toString();
}

function dec(value: DecimalInput | null | undefined): Decimal {
  return toD(value ?? 0);
}

/**
 * Firm-day key (YYYY-MM-DD) of an instant in the challenge timezone, the
 * day ending at resetTimeLocal. Falls back to the UTC calendar date when
 * the timezone or reset time is invalid - never throws.
 */
export function firmDayKey(
  instant: Date,
  timezone: string,
  resetTimeLocal: string,
): { day: string; fallback: boolean } {
  try {
    const day = getTradingDay(instant, timezone, {
      mode: "CUSTOM",
      rolloverTime: resetTimeLocal,
      rolloverTimezone: timezone,
    });
    return { day, fallback: false };
  } catch {
    return { day: instant.toISOString().slice(0, 10), fallback: true };
  }
}

/** True when the position is open at any instant of a UTC weekend. */
function heldOverWeekend(entryTime: Date, exitTime: Date): boolean {
  // Walk the weekends the trade spans: a weekend is [Sat 00:00 UTC, Mon 00:00 UTC).
  const cursor = new Date(
    Date.UTC(
      entryTime.getUTCFullYear(),
      entryTime.getUTCMonth(),
      entryTime.getUTCDate(),
    ),
  );
  const end = exitTime.getTime();
  for (let i = 0; i < 370 && cursor.getTime() < end; i++) {
    const weekday = cursor.getUTCDay(); // 6 = Saturday
    if (weekday === 6) {
      const weekendStart = cursor.getTime();
      const weekendEnd = weekendStart + 2 * 24 * 60 * 60 * 1000;
      if (entryTime.getTime() < weekendEnd && end > weekendStart) return true;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

export function evaluatePropPhase(input: PropEngineInput): PropEngineResult {
  const start = toD(input.phaseStartingBalance);
  const rule = input.rule;
  const now = input.now;

  // ── Adjusted equity timeline (absolute values, cash flows excluded) ──
  // Each point is (instant, adjusted equity). Trade exits add their P&L;
  // snapshots contribute their real equity minus the cash moved before them.
  type Point = { time: number; equity: Decimal };
  const points: Point[] = [{ time: input.phaseStart.getTime(), equity: start }];

  const cashSorted = [...input.cashFlows].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const cashBefore = (instant: Date): Decimal => {
    let total = D0;
    for (const flow of cashSorted) {
      if (flow.date.getTime() <= instant.getTime()) total = total.plus(dec(flow.amount));
      else break;
    }
    return total;
  };

  let closedPnl = D0;
  const closedTrades = input.trades.filter(
    (t) => t.exitTime != null && t.netPnl != null,
  );
  // Exits in time order so the running total stays monotone.
  const exitsSorted = [...closedTrades].sort(
    (a, b) => a.exitTime!.getTime() - b.exitTime!.getTime(),
  );
  let running = start;
  for (const trade of exitsSorted) {
    const pnl = dec(trade.netPnl);
    closedPnl = closedPnl.plus(pnl);
    running = running.plus(pnl);
    points.push({ time: trade.exitTime!.getTime(), equity: running });
  }

  // Balance series: phase start + exits only. The full series adds the
  // snapshots (open positions included, cash-flow-adjusted).
  const balancePoints: Point[] = [...points];
  for (const snapshot of input.equityPoints) {
    const adjusted = dec(snapshot.equity).minus(cashBefore(snapshot.time));
    points.push({ time: snapshot.time.getTime(), equity: adjusted });
  }
  points.sort((a, b) => a.time - b.time);

  // Measurement basis: TRAILING / EQUITY_BASED runs on the full equity
  // series (snapshots included); STATIC / BALANCE_BASED runs on the
  // closed-trade balance series only, so an open drawdown never breaches
  // a balance-based rule.
  const isTrailingBasis =
    rule.drawdownType === "TRAILING" || rule.drawdownType === "EQUITY_BASED";
  const series = isTrailingBasis ? points : balancePoints;

  const currentEquity = series.length > 0 ? series[series.length - 1].equity : start;
  // The last series point may be an old snapshot: the closed-trade total
  // is newer when its latest exit is after the latest snapshot.
  const latestExitTime =
    exitsSorted.length > 0 ? exitsSorted[exitsSorted.length - 1].exitTime!.getTime() : -1;
  const latestSnapshotTime =
    input.equityPoints.length > 0
      ? Math.max(...input.equityPoints.map((p) => p.time.getTime()))
      : -1;
  const currentAdjusted =
    !isTrailingBasis || latestExitTime >= latestSnapshotTime
      ? start.plus(closedPnl)
      : currentEquity;
  const totalCash = cashSorted.reduce((sum, f) => sum.plus(dec(f.amount)), D0);
  const currentBalance = currentAdjusted.plus(totalCash);

  let peak = start;
  let worstDrawdown = D0;
  let runningPeak = start;
  for (const point of series) {
    if (point.equity.gt(runningPeak)) runningPeak = point.equity;
    if (point.equity.gt(peak)) peak = point.equity;
    const fromPeak = runningPeak.minus(point.equity);
    if (fromPeak.gt(worstDrawdown)) worstDrawdown = fromPeak;
  }
  const staticDrawdown = start.minus(
    series.reduce((min, p) => (p.equity.lt(min) ? p.equity : min), start),
  );
  const trailingDrawdown = worstDrawdown;

  const ddUsed = isTrailingBasis ? trailingDrawdown : staticDrawdown.gt(0) ? staticDrawdown : D0;
  const ddLimit =
    rule.maxTotalDrawdownPercent == null
      ? null
      : toD(rule.maxTotalDrawdownPercent).div(100).times(start);

  // ── Firm days ──
  let timezoneFallback = false;
  const dayKey = (instant: Date): string => {
    const result = firmDayKey(instant, input.timezone, input.resetTimeLocal);
    if (result.fallback) timezoneFallback = true;
    return result.day;
  };
  const phaseStartDay = dayKey(input.phaseStart);

  const todayKey = dayKey(now);
  const daysMap = new Map<string, { trades: number; netPnl: Decimal }>();
  const ensureDay = (day: string) => {
    let entry = daysMap.get(day);
    if (!entry) {
      entry = { trades: 0, netPnl: D0 };
      daysMap.set(day, entry);
    }
    return entry;
  };
  // A trading day counts a day with trade activity: an entry or an exit.
  // Activity before the phase started does not count (a trade entered
  // before the phase but closed inside it still counts its exit P&L).
  for (const trade of input.trades) {
    if (dayKey(trade.entryTime) >= phaseStartDay) {
      ensureDay(dayKey(trade.entryTime)).trades += 1;
    }
    if (trade.exitTime != null) {
      const exitDay = ensureDay(dayKey(trade.exitTime));
      if (trade.netPnl != null) exitDay.netPnl = exitDay.netPnl.plus(dec(trade.netPnl));
    }
  }
  const tradingDays = [...daysMap.values()].filter((d) => d.trades > 0).length;

  // Daily loss: worst firm day, measured on the adjusted series (day-start
  // equity minus the lowest point inside the day). Without snapshots the
  // series only moves at exits, so this reduces to the closed day P&L.
  let worstDailyLoss = D0;
  let worstDailyDay: string | null = null;
  const dayStarts = new Map<string, Decimal>();
  const dayLows = new Map<string, Decimal>();
  let cursorEquity = start;
  let cursorDay = dayKey(input.phaseStart);
  dayStarts.set(cursorDay, start);
  dayLows.set(cursorDay, start);
  for (const point of series) {
    const day = dayKey(new Date(point.time));
    if (day !== cursorDay) {
      cursorDay = day;
      if (!dayStarts.has(day)) dayStarts.set(day, cursorEquity);
      if (!dayLows.has(day)) dayLows.set(day, cursorEquity);
    }
    if (point.equity.lt(dayLows.get(day)!)) dayLows.set(day, point.equity);
    cursorEquity = point.equity;
  }
  for (const [day, low] of dayLows) {
    const loss = (dayStarts.get(day) ?? start).minus(low);
    if (loss.gt(worstDailyLoss)) {
      worstDailyLoss = loss;
      worstDailyDay = day;
    }
  }
  const todayEntry = daysMap.get(todayKey);
  const todayPnl = todayEntry ? todayEntry.netPnl : D0;
  const dailyLimit =
    rule.maxDailyLossPercent == null
      ? null
      : toD(rule.maxDailyLossPercent).div(100).times(start);

  // ── Profit target ──
  const targetPercent = toD(rule.profitTargetPercent ?? "0");
  const targetAmount = targetPercent.gt(0) ? targetPercent.div(100).times(start) : null;
  const gained = currentAdjusted.minus(start).gt(0)
    ? currentAdjusted.minus(start)
    : D0;
  const targetReached = targetAmount != null && gained.gte(targetAmount);

  // ── Consistency: best day share of total profit ──
  const dayPnls = [...daysMap.values()].map((d) => d.netPnl);
  const totalProfit = dayPnls.reduce((sum, p) => sum.plus(p), D0);
  const bestDay = dayPnls.reduce((best, p) => (p.gt(best) ? p : best), D0);
  const consistencyLimit =
    rule.consistencyRulePercent == null
      ? null
      : toD(rule.consistencyRulePercent);
  let consistencyUsed: Decimal | null = null;
  let consistencyStatus: PropRuleStatus = "SKIPPED";
  let consistencyDetail = "No consistency rule configured for this phase.";
  if (consistencyLimit != null) {
    if (totalProfit.lte(0) || bestDay.lte(0)) {
      consistencyUsed = D0;
      consistencyStatus = "PASS";
      consistencyDetail =
        "No profitable day yet, so no single day dominates the profit.";
    } else {
      consistencyUsed = bestDay.div(totalProfit).times(100);
      consistencyStatus = limitStatus(consistencyUsed, consistencyLimit);
      consistencyDetail =
        consistencyStatus === "BREACH"
          ? `Best day made ${consistencyUsed.toFixed(2)}% of the total profit, above the ${consistencyLimit.toString()}% consistency limit.`
          : `Best day is ${consistencyUsed.toFixed(2)}% of the total profit (limit ${consistencyLimit.toString()}%).`;
    }
  }

  // ── Weekend holding ──
  let weekendStatus: PropRuleStatus = "SKIPPED";
  let weekendDetail = "Weekend holding is allowed for this phase.";
  let weekendCount = 0;
  if (!rule.weekendHoldingAllowed) {
    const offenders = input.trades.filter((t) => {
      // Only the part of the position held inside the phase counts.
      const effectiveEntry =
        t.entryTime.getTime() < input.phaseStart.getTime()
          ? input.phaseStart
          : t.entryTime;
      return heldOverWeekend(effectiveEntry, t.exitTime ?? now);
    });
    weekendCount = offenders.length;
    weekendStatus = weekendCount > 0 ? "BREACH" : "PASS";
    weekendDetail =
      weekendCount > 0
        ? `${weekendCount} trade${weekendCount > 1 ? "s" : ""} held over a weekend, which this phase forbids.`
        : "No trade was held over a weekend.";
  }

  // ── Rules ──
  const rules: PropRuleEvaluation[] = [];
  const dailyStatus = limitStatus(worstDailyLoss, dailyLimit);
  rules.push({
    rule: "DAILY_LOSS",
    status: dailyLimit == null ? "SKIPPED" : dailyStatus,
    detail:
      dailyLimit == null
        ? "No daily loss limit configured for this phase."
        : worstDailyLoss.gt(0)
          ? `Worst day lost ${worstDailyLoss.toString()}${worstDailyDay ? ` (${worstDailyDay})` : ""} of a ${dailyLimit.toString()} limit.`
          : "No losing day so far.",
    used: dailyLimit == null ? null : worstDailyLoss.toString(),
    limit: dailyLimit?.toString() ?? null,
    usedPercent: pct(worstDailyLoss, dailyLimit),
    remaining: dailyLimit == null ? null : dailyLimit.minus(worstDailyLoss).toString(),
  });
  const ddStatus = limitStatus(ddUsed, ddLimit);
  rules.push({
    rule: "TOTAL_DRAWDOWN",
    status: ddLimit == null ? "SKIPPED" : ddStatus,
    detail:
      ddLimit == null
        ? "No total drawdown limit configured for this phase."
        : ddUsed.gt(0)
          ? `${isTrailingBasis ? "Trailing" : "Static"} drawdown reached ${ddUsed.toString()} of a ${ddLimit.toString()} limit (peak ${peak.toString()}).`
          : "Equity never went below its reference, no drawdown used.",
    used: ddLimit == null ? null : ddUsed.toString(),
    limit: ddLimit?.toString() ?? null,
    usedPercent: pct(ddUsed, ddLimit),
    remaining: ddLimit == null ? null : ddLimit.minus(ddUsed).toString(),
  });
  rules.push({
    rule: "PROFIT_TARGET",
    status:
      targetAmount == null ? "SKIPPED" : targetReached ? "PASS" : "PENDING",
    detail:
      targetAmount == null
        ? "No profit target configured for this phase."
        : targetReached
          ? `Target reached: gained ${gained.toString()} of a ${targetAmount.toString()} target.`
          : `Gained ${gained.toString()} of a ${targetAmount.toString()} target (${targetAmount.isZero() ? "0" : gained.div(targetAmount).times(100).toFixed(2)}% of the way).`,
    used: targetAmount == null ? null : gained.toString(),
    limit: targetAmount?.toString() ?? null,
    usedPercent:
      targetAmount == null || targetAmount.isZero()
        ? null
        : gained.div(targetAmount).times(100).toString(),
    remaining: targetAmount == null ? null : targetAmount.minus(gained).toString(),
  });
  const minDaysMet = tradingDays >= rule.minTradingDays;
  rules.push({
    rule: "MIN_TRADING_DAYS",
    status:
      rule.minTradingDays <= 0 ? "SKIPPED" : minDaysMet ? "PASS" : "PENDING",
    detail:
      rule.minTradingDays <= 0
        ? "No minimum trading days configured for this phase."
        : minDaysMet
          ? `${tradingDays} trading days, minimum ${rule.minTradingDays} met.`
          : `${tradingDays} of ${rule.minTradingDays} minimum trading days so far.`,
    used: rule.minTradingDays <= 0 ? null : String(tradingDays),
    limit: rule.minTradingDays <= 0 ? null : String(rule.minTradingDays),
    usedPercent:
      rule.minTradingDays <= 0
        ? null
        : new Decimal(tradingDays).div(rule.minTradingDays).times(100).toString(),
    remaining:
      rule.minTradingDays <= 0
        ? null
        : String(Math.max(0, rule.minTradingDays - tradingDays)),
  });
  const maxDaysExceeded =
    rule.maxTradingDays != null && tradingDays > rule.maxTradingDays;
  rules.push({
    rule: "MAX_TRADING_DAYS",
    status:
      rule.maxTradingDays == null
        ? "SKIPPED"
        : maxDaysExceeded
          ? "BREACH"
          : "PASS",
    detail:
      rule.maxTradingDays == null
        ? "No maximum trading days configured for this phase."
        : maxDaysExceeded
          ? `${tradingDays} trading days used, over the ${rule.maxTradingDays} day limit without passing.`
          : `${tradingDays} of ${rule.maxTradingDays} maximum trading days used.`,
    used: rule.maxTradingDays == null ? null : String(tradingDays),
    limit: rule.maxTradingDays == null ? null : String(rule.maxTradingDays),
    usedPercent:
      rule.maxTradingDays == null
        ? null
        : new Decimal(tradingDays).div(rule.maxTradingDays).times(100).toString(),
    remaining:
      rule.maxTradingDays == null
        ? null
        : String(Math.max(0, rule.maxTradingDays - tradingDays)),
  });
  rules.push({
    rule: "CONSISTENCY",
    status: consistencyStatus,
    detail: consistencyDetail,
    used: consistencyUsed?.toString() ?? null,
    limit: consistencyLimit?.toString() ?? null,
    usedPercent: consistencyUsed?.toString() ?? null,
    remaining:
      consistencyLimit == null || consistencyUsed == null
        ? null
        : consistencyLimit.minus(consistencyUsed).toString(),
  });
  rules.push({
    rule: "WEEKEND_HOLDING",
    status: weekendStatus,
    detail: weekendDetail,
    used: rule.weekendHoldingAllowed ? null : String(weekendCount),
    limit: null,
    usedPercent: null,
    remaining: null,
  });
  rules.push({
    rule: "NEWS_TRADING",
    status: rule.newsTradingRestricted ? "UNKNOWN" : "SKIPPED",
    detail: rule.newsTradingRestricted
      ? "News data is not available, so news trading cannot be checked automatically."
      : "News trading is not restricted for this phase.",
    used: null,
    limit: null,
    usedPercent: null,
    remaining: null,
  });
  rules.push({
    rule: "LEVERAGE",
    status: rule.leverage == null ? "SKIPPED" : "UNKNOWN",
    detail:
      rule.leverage == null
        ? "No leverage limit configured for this phase."
        : "Leverage is not recorded per trade, so the limit cannot be checked automatically.",
    used: null,
    limit: rule.leverage,
    usedPercent: null,
    remaining: null,
  });

  // ── Phase outcome ──
  const breachOrder: PropRuleId[] = [
    "DAILY_LOSS",
    "TOTAL_DRAWDOWN",
    "MAX_TRADING_DAYS",
    "CONSISTENCY",
    "WEEKEND_HOLDING",
  ];
  const breached = rules.find(
    (r) => r.status === "BREACH" && breachOrder.includes(r.rule),
  );
  const failReasonMap: Record<string, PropPhaseOutcome["failReason"]> = {
    DAILY_LOSS: "MAX_DAILY_LOSS",
    TOTAL_DRAWDOWN: "MAX_DRAWDOWN",
    MAX_TRADING_DAYS: "TIME_LIMIT",
    CONSISTENCY: "RULE_VIOLATION",
    WEEKEND_HOLDING: "RULE_VIOLATION",
  };
  const reasons: string[] = [];
  let phaseOutcome: PropPhaseOutcome;
  if (breached) {
    reasons.push(breached.detail);
    phaseOutcome = {
      outcome: "FAILED",
      failReason: failReasonMap[breached.rule] ?? "RULE_VIOLATION",
      failRule: breached.rule,
      recommendedAction: "MARK_PHASE_FAILED",
      reasons,
    };
  } else if (targetReached && minDaysMet) {
    reasons.push("Profit target reached and minimum trading days met, no rule breached.");
    phaseOutcome = {
      outcome: "PASSED",
      failReason: null,
      failRule: null,
      recommendedAction: "MARK_PHASE_PASSED",
      reasons,
    };
  } else {
    if (!targetReached && targetAmount != null)
      reasons.push(`Profit target not reached yet (${gained.toString()} of ${targetAmount.toString()}).`);
    if (!minDaysMet && rule.minTradingDays > 0)
      reasons.push(`Minimum trading days not met yet (${tradingDays} of ${rule.minTradingDays}).`);
    if (reasons.length === 0) reasons.push("Phase still in progress.");
    phaseOutcome = {
      outcome: "IN_PROGRESS",
      failReason: null,
      failRule: null,
      recommendedAction: "NONE",
      reasons,
    };
  }

  // ── Day-by-day history (firm days from phase start through today) ──
  const days: PropEvaluationDay[] = [];
  const firstDay = dayKey(input.phaseStart);
  const lastDay = todayKey;
  const dayList: string[] = [];
  {
    const [y, m, d] = firstDay.split("-").map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d));
    const [ly, lm, ld] = lastDay.split("-").map(Number);
    const last = new Date(Date.UTC(ly, lm - 1, ld));
    for (let i = 0; i < 730 && cursor.getTime() <= last.getTime(); i++) {
      dayList.push(
        `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`,
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  // Walk the firm days in order, advancing through the points once: the
  // running peak covers every point so far, not just end-of-day values.
  let pointIdx = 0;
  let equityCursor = start;
  let peakCursor = start;
  for (const day of dayList) {
    while (
      pointIdx < series.length &&
      dayKey(new Date(series[pointIdx].time)) <= day
    ) {
      equityCursor = series[pointIdx].equity;
      if (equityCursor.gt(peakCursor)) peakCursor = equityCursor;
      pointIdx++;
    }
    const entry = daysMap.get(day);
    const base = isTrailingBasis ? peakCursor : start;
    const dd = equityCursor.lt(base) ? base.minus(equityCursor) : D0;
    days.push({
      day,
      trades: entry?.trades ?? 0,
      netPnl: (entry?.netPnl ?? D0).toString(),
      equity: equityCursor.toString(),
      drawdown: dd.toString(),
      isTradingDay: (entry?.trades ?? 0) > 0,
    });
  }

  const equityData: PropEngineResult["equityData"] =
    input.equityPoints.length > 0 ? "SNAPSHOTS" : "CLOSED_ONLY";
  const equityDataNote =
    input.equityPoints.length === 0
      ? "No equity snapshots in this phase - open positions and intraday moves are not visible, evaluation uses closed trades only."
      : !isTrailingBasis
        ? "This phase measures drawdown on balance - equity snapshots are available but do not count toward the limits."
        : null;

  return {
    currentBalance: currentBalance.toString(),
    currentEquity: currentAdjusted.toString(),
    peakEquity: peak.toString(),
    todayPnl: todayPnl.toString(),
    todayDayKey: todayKey,
    tradingDays,
    equityData,
    equityDataNote,
    timezoneFallback,
    rules,
    phaseOutcome,
    days,
  };
}
