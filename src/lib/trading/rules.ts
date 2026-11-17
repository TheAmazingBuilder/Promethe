/**
 * Rule violation detection engine (v1 phase 6) — pure & client-safe.
 *
 * Personal trading rules guard discipline: max trades per day, max daily
 * loss, max risk per trade. The detector runs when a trade is created or
 * updated (P&L/risk can change on close/edit) and rewrites the violations
 * attached to THAT trade (delete-then-insert, idempotent).
 *
 * Semantics (documented — mirrors the calendar's trading-day attribution):
 * - MAX_TRADES_PER_DAY  : violation when the count of non-draft trades
 *   OPENED on the same trading day (user setting, entry time) as the trade,
 *   including the trade itself, EXCEEDS the limit (count > value).
 * - MAX_DAILY_LOSS      : violation when the net P&L of the same trading day
 *   as the trade's EXIT (closed trades only, exit-day attribution — same
 *   convention as the P&L calendar), including this trade, is ≤ −value.
 *   Evaluated only on CLOSED trades.
 * - MAX_RISK_PER_TRADE  : violation when the trade's own risk amount
 *   (riskAmount) EXCEEDS the limit (risk > value). Open trades count —
 *   the risk is known at entry.
 * - CUSTOM              : documentation-only rule, never auto-detected.
 *
 * Rule values are positive decimal strings (account currency for money
 * rules). All math goes through decimal.js (toD) — never floats.
 */
import { Decimal, toD } from "@/lib/trading/dec";

export const RULE_KINDS = [
  "MAX_TRADES_PER_DAY",
  "MAX_DAILY_LOSS",
  "MAX_RISK_PER_TRADE",
  "CUSTOM",
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

export interface RuleDef {
  id: string;
  kind: RuleKind;
  /** Positive decimal string (count for MAX_TRADES_PER_DAY, money otherwise). */
  value: string;
  description: string | null;
  isActive: boolean;
}

/** The trade under evaluation, with its trading-day keys precomputed. */
export interface RuleTradeContext {
  status: string; // OPEN | CLOSED
  isDraft: boolean;
  /** Trading day (YYYY-MM-DD, user setting) of the ENTRY time. */
  entryLocalDay: string;
  /** Trading day of the EXIT time - null while the trade is open. */
  exitLocalDay: string | null;
  /** Risk at entry (account currency) - null when unknown. */
  riskAmount: string | null;
  /** Realized net P&L - null while open. */
  netPnl: string | null;
}

/** Day aggregates around the trade (both INCLUDE the trade itself). */
export interface RuleDayContext {
  /** Non-draft trades opened on trade.entryLocalDay, incl. the trade. */
  entryDayCount: number;
  /**
   * Net P&L of every CLOSED non-draft trade exiting on the trade's exit
   * day, incl. the trade — empty for open trades.
   */
  exitDayPnl: string[];
}

export interface RuleViolationResult {
  ruleId: string;
  kind: Exclude<RuleKind, "CUSTOM">;
  /** Machine-readable measured value (i18n happens at display time). */
  measured: string;
  /** The violated limit, as written on the rule. */
  limit: string;
}

function violatesMaxTradesPerDay(
  rule: RuleDef,
  ctx: RuleDayContext
): RuleViolationResult | null {
  const count = ctx.entryDayCount;
  const limit = toD(rule.value);
  if (limit.lte(0)) return null;
  if (!(new Decimal(count).gt(limit))) return null;
  return {
    ruleId: rule.id,
    kind: "MAX_TRADES_PER_DAY",
    measured: String(count),
    limit: limit.toString(),
  };
}

function violatesMaxDailyLoss(
  rule: RuleDef,
  trade: RuleTradeContext,
  day: RuleDayContext
): RuleViolationResult | null {
  if (trade.status !== "CLOSED") return null;
  const limit = toD(rule.value);
  if (limit.lte(0)) return null;
  let dayPnl: Decimal = toD(0);
  for (const pnl of day.exitDayPnl) dayPnl = dayPnl.plus(toD(pnl));
  // Violated once the day's loss REACHES the limit (≤ −limit).
  if (!dayPnl.lte(limit.negated())) return null;
  return {
    ruleId: rule.id,
    kind: "MAX_DAILY_LOSS",
    measured: dayPnl.toString(),
    limit: limit.negated().toString(),
  };
}

function violatesMaxRiskPerTrade(
  rule: RuleDef,
  trade: RuleTradeContext
): RuleViolationResult | null {
  if (trade.riskAmount == null) return null;
  const limit = toD(rule.value);
  if (limit.lte(0)) return null;
  const risk = toD(trade.riskAmount);
  if (!risk.gt(limit)) return null;
  return {
    ruleId: rule.id,
    kind: "MAX_RISK_PER_TRADE",
    measured: risk.toString(),
    limit: limit.toString(),
  };
}

/**
 * Evaluate all rules against one trade. Draft trades are never evaluated
 * (they are not real positions yet). CUSTOM rules never fire — they are
 * documentation for the trader, not machine-checkable limits.
 */
export function evaluateRules(
  rules: RuleDef[],
  trade: RuleTradeContext,
  day: RuleDayContext
): RuleViolationResult[] {
  if (trade.isDraft) return [];
  const violations: RuleViolationResult[] = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    switch (rule.kind) {
      case "MAX_TRADES_PER_DAY": {
        const v = violatesMaxTradesPerDay(rule, day);
        if (v) violations.push(v);
        break;
      }
      case "MAX_DAILY_LOSS": {
        const v = violatesMaxDailyLoss(rule, trade, day);
        if (v) violations.push(v);
        break;
      }
      case "MAX_RISK_PER_TRADE": {
        const v = violatesMaxRiskPerTrade(rule, trade);
        if (v) violations.push(v);
        break;
      }
      case "CUSTOM":
        break;
    }
  }
  return violations;
}
