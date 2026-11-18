/**
 * Predefined goal templates (MRT wave 3 — Goals).
 *
 * These live in code only and are NEVER seeded in the database: only
 * the goals the user actually adds (via "Add goal" on /analytics/goals)
 * become Goal rows, created through the existing POST /api/goals. The
 * targets mirror the MRT demo goals (70% win rate on A+ setups, 90%
 * plan follow-through, 30 logged trades with a screenshot) plus the two
 * most-asked overall goals. Names and descriptions are i18n keys under
 * `analytics.advanced.goals.templates.<id>` so the stored goal name is
 * the resolved English string, like a name the user typed.
 */
import type { GoalMetric, GoalPeriod } from "./goals";

export interface GoalTemplate {
  id: string;
  metric: GoalMetric;
  /** Positive decimal string, same format as GoalInput.targetValue. */
  targetValue: string;
  period: GoalPeriod;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: "a-plus-win-rate",
    metric: "A_PLUS_WIN_RATE",
    targetValue: "70",
    period: "MONTHLY",
  },
  {
    id: "follow-plan",
    metric: "PLAN_FOLLOW_RATE",
    targetValue: "90",
    period: "MONTHLY",
  },
  {
    id: "log-with-screenshot",
    metric: "TRADES_WITH_SCREENSHOT",
    targetValue: "30",
    period: "MONTHLY",
  },
  {
    id: "win-rate",
    metric: "WIN_RATE",
    targetValue: "60",
    period: "MONTHLY",
  },
  {
    id: "trades-this-month",
    metric: "TRADE_COUNT",
    targetValue: "20",
    period: "MONTHLY",
  },
];

export function findGoalTemplate(id: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.id === id);
}
