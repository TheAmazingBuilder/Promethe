"use client";

/**
 * Shared display helpers for goals & rules (v1 phase 6) — metric-aware
 * value formatting + progress tone. Kept client-safe and pure.
 *
 * This module is pure (no hooks), so the privacy-aware money/percent
 * formatters are threaded in by the callers as a `FormatApi` obtained from
 * `useFormat()` — in HIDE mode they yield the "••••" placeholder.
 */
import { fmtNum } from "@/lib/format";
import { toD } from "@/lib/trading/dec";
import type { GoalMetric } from "@/lib/trading/goals";
import type { FormatApi } from "@/lib/format/use-format";

export const METRICS: GoalMetric[] = [
  "NET_PNL",
  "WIN_RATE",
  "AVG_R",
  "PROFIT_FACTOR",
  "TRADE_COUNT",
  "DISCIPLINE_SCORE",
];

export const PERIODS = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "ALL_TIME",
] as const;

export type GoalPeriodValue = (typeof PERIODS)[number];

export const RULE_KIND_LIST = [
  "MAX_TRADES_PER_DAY",
  "MAX_DAILY_LOSS",
  "MAX_RISK_PER_TRADE",
  "CUSTOM",
] as const;

export type RuleKindValue = (typeof RULE_KIND_LIST)[number];

/** Format a metric value (current or target) for display. */
export function formatGoalValue(
  fmt: FormatApi,
  metric: string,
  value: string | null,
  currency: string
): string {
  if (value == null) return "—";
  switch (metric) {
    case "NET_PNL":
      return fmt.signedMoney(value, currency);
    case "WIN_RATE":
      return fmt.pct(value);
    case "AVG_R": {
      const n = Number(value);
      return Number.isFinite(n) ? `${fmtNum(n)} R` : value;
    }
    case "PROFIT_FACTOR": {
      const n = Number(value);
      return Number.isFinite(n) ? fmtNum(n) : "∞";
    }
    case "TRADE_COUNT":
      return fmtNum(Number(value), 0);
    case "DISCIPLINE_SCORE":
      return `${fmtNum(Number(value))}/5`;
    default:
      return value;
  }
}

/** Progress bar color — achieved = gain token, close = amber, else primary. */
export function goalBarTone(progressPercent: number, isAchieved: boolean): string {
  if (isAchieved) return "bg-gain";
  if (progressPercent >= 75) return "bg-amber-500";
  return "bg-primary";
}

/** Rule limit display — count vs money depending on the kind. */
export function formatRuleValue(
  fmt: FormatApi,
  kind: string,
  value: string,
  currency: string
): string {
  if (kind === "MAX_TRADES_PER_DAY") return fmtNum(Number(value), 0);
  if (kind === "CUSTOM") return value;
  return fmt.money(value, currency);
}

/** Violation measured value display (matches the rule kind). */
export function formatMeasuredValue(
  fmt: FormatApi,
  kind: string,
  measured: string,
  currency: string
): string {
  if (measured === "") return "—";
  if (kind === "MAX_TRADES_PER_DAY") return fmtNum(Number(measured), 0);
  if (kind === "MAX_DAILY_LOSS" || kind === "MAX_RISK_PER_TRADE") {
    return fmt.signedMoney(measured, currency);
  }
  return measured;
}

/** Is the measured value numerically meaningful (used for tone)? */
export function measuredIsNegative(kind: string, measured: string): boolean {
  if (measured === "") return false;
  try {
    return toD(measured).lt(0);
  } catch {
    return false;
  }
}
