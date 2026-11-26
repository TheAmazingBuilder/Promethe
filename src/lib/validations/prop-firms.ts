/**
 * Validation for Prop Firm Management.
 * Monetary values remain decimal strings so Prisma Decimal never receives
 * binary floating-point values from the browser.
 */
import { z } from "zod";
import { isoDay } from "@/lib/validations/journal";

const decimal = z.string().trim().min(1).max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "invalidDecimal");
const positiveDecimal = decimal.refine((value) => Number(value) > 0, "mustBePositive");
const percentDecimal = decimal.refine((value) => Number(value) <= 100, "invalidPercent");
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "invalidCurrency");
const timezone = z.string().trim().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "invalidTimezone");

export const PROP_PHASES = ["PHASE_1", "PHASE_2", "FUNDED"] as const;
export const PROP_CHALLENGE_PHASES = [...PROP_PHASES, "FAILED", "PASSED", "ABANDONED"] as const;
export const PROP_CHALLENGE_STATUSES = ["IN_PROGRESS", "PASSED", "FAILED", "ABANDONED"] as const;

export const propPhaseRuleSchema = z.object({
  phase: z.enum(PROP_PHASES),
  profitTargetPercent: percentDecimal,
  maxDailyLossPercent: percentDecimal.nullable(),
  maxTotalDrawdownPercent: percentDecimal.nullable(),
  drawdownType: z.enum(["STATIC", "TRAILING", "EQUITY_BASED", "BALANCE_BASED"]),
  minTradingDays: z.number().int().min(0).max(365),
  maxTradingDays: z.number().int().min(1).max(365).nullable(),
  consistencyRulePercent: percentDecimal.nullable(),
  newsTradingRestricted: z.boolean(),
  weekendHoldingAllowed: z.boolean(),
  leverage: positiveDecimal.nullable(),
}).superRefine((value, ctx) => {
  if (value.maxTradingDays != null && value.maxTradingDays < value.minTradingDays) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxTradingDays"],
      message: "maxTradingDays must not be lower than minTradingDays.",
    });
  }
});

export const propFirmPhasesSchema = z.array(propPhaseRuleSchema).min(1).max(3)
  .superRefine((phases, ctx) => {
    const names = phases.map((phase) => phase.phase);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A phase can only appear once in a rule set.",
      });
    }
  });

export type PropPhaseRuleInput = z.infer<typeof propPhaseRuleSchema>;

export const propFirmRuleSetInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  firm: z.string().trim().min(1).max(80),
  phases: propFirmPhasesSchema,
  resetTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone,
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type PropFirmRuleSetInput = z.infer<typeof propFirmRuleSetInputSchema>;
export const propFirmRuleSetPatchSchema = propFirmRuleSetInputSchema.partial();
export type PropFirmRuleSetPatch = z.infer<typeof propFirmRuleSetPatchSchema>;

export const propChallengeInputSchema = z.object({
  accountId: z.string().trim().min(1).max(64),
  ruleSetId: z.string().trim().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  firm: z.string().trim().min(1).max(80),
  accountSize: positiveDecimal,
  challengeFee: decimal,
  feeCurrency: currencyCode,
  purchaseDate: isoDay.nullable().optional(),
  startDate: isoDay,
  endDate: isoDay.nullable().optional(),
  currentPhase: z.enum(PROP_CHALLENGE_PHASES).default("PHASE_1"),
  status: z.enum(PROP_CHALLENGE_STATUSES).default("IN_PROGRESS"),
  notes: z.string().trim().max(3000).nullable().optional(),
  phases: propFirmPhasesSchema.optional(),
  /// Frozen at purchase for custom (rule-set-less) challenges; when a rule
  /// set is chosen, its timezone and reset time win (Lot 5).
  timezone: timezone.nullable().optional(),
  resetTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.ruleSetId == null && value.phases == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phases"],
      message: "Choose a rule set or provide a rules snapshot.",
    });
  }
  if (value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "The end date must not precede the start date.",
    });
  }
});
export type PropChallengeInput = z.infer<typeof propChallengeInputSchema>;

export const propChallengePatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  firm: z.string().trim().min(1).max(80).optional(),
  currentPhase: z.enum(PROP_CHALLENGE_PHASES).optional(),
  status: z.enum(PROP_CHALLENGE_STATUSES).optional(),
  endDate: isoDay.nullable().optional(),
  notes: z.string().trim().max(3000).nullable().optional(),
});
export type PropChallengePatch = z.infer<typeof propChallengePatchSchema>;

export const propPhaseResultInputSchema = z.object({
  phase: z.enum(PROP_PHASES),
  startDate: isoDay.nullable().optional(),
  endDate: isoDay.nullable().optional(),
  startingBalance: decimal.nullable().optional(),
  endingBalance: decimal.nullable().optional(),
  result: z.enum(["PASSED", "FAILED", "IN_PROGRESS"]).default("IN_PROGRESS"),
  failReason: z.enum(["MAX_DAILY_LOSS", "MAX_DRAWDOWN", "TIME_LIMIT", "RULE_VIOLATION", "OTHER"]).nullable().optional(),
  tradingDaysCount: z.number().int().min(0).max(1000).default(0),
});
export type PropPhaseResultInput = z.infer<typeof propPhaseResultInputSchema>;

export const propPayoutInputSchema = z.object({
  grossAmount: positiveDecimal,
  profitSplitPercent: z.number().min(0).max(100),
  currency: currencyCode,
  requestedAt: isoDay.optional(),
  receivedAt: isoDay.nullable().optional(),
  method: z.string().trim().max(80).nullable().optional(),
  status: z.enum(["REQUESTED", "RECEIVED", "REJECTED"]).default("REQUESTED"),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type PropPayoutInput = z.infer<typeof propPayoutInputSchema>;
export const propPayoutPatchSchema = propPayoutInputSchema.partial();
export type PropPayoutPatch = z.infer<typeof propPayoutPatchSchema>;

export const propExpenseInputSchema = z.object({
  challengeId: z.string().trim().min(1).max(64).nullable().optional(),
  type: z.enum(["FEE", "RESET", "ADDON", "OTHER"]),
  amount: positiveDecimal,
  currency: currencyCode,
  date: isoDay,
  note: z.string().trim().max(1000).nullable().optional(),
});
export type PropExpenseInput = z.infer<typeof propExpenseInputSchema>;
export const propExpensePatchSchema = propExpenseInputSchema.partial();
export type PropExpensePatch = z.infer<typeof propExpensePatchSchema>;
