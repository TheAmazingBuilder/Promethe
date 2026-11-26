/**
 * Zod schemas for the analytics endpoint (v2 Phase 4) — shared by the API
 * route and the client query hook. Client-safe: imports zod only.
 */
import { z } from "zod";

export const ANALYTICS_PERIODS = ["30d", "90d", "ytd", "all"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/**
 * Advanced analytics modules (Phase 2 perf: the endpoint computes only the
 * requested module). `score` covers both the trader score and its history.
 */
export const ADVANCED_MODULES = [
  "lifecycle",
  "exits",
  "score",
  "setups",
  "confluences",
  "grades",
  "cross-analysis",
  "sequences",
  "seasonality",
  "anomalies",
] as const;
export type AdvancedModule = (typeof ADVANCED_MODULES)[number];

export const analyticsQuerySchema = z.object({
  period: z.enum(ANALYTICS_PERIODS).default("30d"),
  /** Optional account filter (account id). */
  account: z.string().trim().min(1).max(64).optional(),
  /** Optional advanced module filter (advanced endpoint only; ignored elsewhere). */
  module: z.enum(ADVANCED_MODULES).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * Weekly improvement plan query (MRT wave 1) — the plan always covers the
 * last 30 days, so there is no period parameter, only the account filter.
 */
export const weeklyPlanQuerySchema = z.object({
  account: z.string().trim().min(1).max(64).optional(),
});

export type WeeklyPlanQuery = z.infer<typeof weeklyPlanQuerySchema>;

/** Stable rule keys of the weekly plan engine (src/lib/analytics/weekly-plan). */
export const WEEKLY_PLAN_RULES = [
  "worst-session",
  "worst-hour",
  "after-loss",
  "off-playbook",
  "deep-losses",
  "losing-setup",
  "worst-weekday",
  "discipline",
] as const;

export type WeeklyPlanRule = (typeof WEEKLY_PLAN_RULES)[number];

/** Toggle a "Done this week" checkbox on one action of the current week. */
export const weeklyPlanToggleSchema = z.object({
  rule: z.enum(WEEKLY_PLAN_RULES),
  done: z.boolean(),
});

export type WeeklyPlanToggle = z.infer<typeof weeklyPlanToggleSchema>;
