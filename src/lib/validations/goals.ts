/**
 * Zod schemas for goals & trading rules (v1 phase 6) — shared by the client
 * forms and the API routes. Client-safe: imports zod + the pure engine
 * constants only.
 *
 * Conventions:
 *  - Decimal values (targets, rule limits) travel as STRINGS — positive
 *    decimal strings, exact round-trip with decimal.js.
 *  - Dates are local calendar days "YYYY-MM-DD" (user timezone), same as
 *    the journal.
 */
import { z } from "zod";
import { RULE_KINDS } from "@/lib/trading/rules";
import { GOAL_METRICS, GOAL_PERIODS } from "@/lib/trading/goals";
import { isoDay } from "@/lib/validations/journal";

/** Positive decimal string, strictly > 0 (a target/limit of 0 is meaningless). */
const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "invalidDecimal")
  .refine((v) => Number(v) > 0, "invalidDecimal");

// ── Trading rules ───────────────────────────────────────────────────────────

export const ruleInputSchema = z.object({
  kind: z.enum(RULE_KINDS, "required"),
  /** Positive limit: count (MAX_TRADES_PER_DAY) or account-currency amount. */
  value: positiveDecimalString,
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().default(true),
});

export type RuleInput = z.infer<typeof ruleInputSchema>;
export const rulePatchSchema = ruleInputSchema.partial();
export type RulePatch = z.infer<typeof rulePatchSchema>;

// ── Goals ───────────────────────────────────────────────────────────────────

export const GOAL_STATUSES = ["ACTIVE", "PAUSED"] as const;

export const goalInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  description: z.string().trim().max(2000).nullish(),
  metric: z.enum(GOAL_METRICS, "required"),
  /** Positive target — % for WIN_RATE / DISCIPLINE_SCORE(≤5), money, R or count otherwise. */
  targetValue: positiveDecimalString,
  period: z.enum(GOAL_PERIODS, "required"),
  startDate: isoDay,
  endDate: isoDay.nullish(),
  status: z.enum(GOAL_STATUSES).default("ACTIVE"),
});

export type GoalInput = z.infer<typeof goalInputSchema>;
export const goalPatchSchema = goalInputSchema.partial();
export type GoalPatch = z.infer<typeof goalPatchSchema>;

// ── Queries ─────────────────────────────────────────────────────────────────

/** GET /api/rules/violations?days=30 — recent violations window. */
export const violationsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type ViolationsQuery = z.infer<typeof violationsQuerySchema>;
