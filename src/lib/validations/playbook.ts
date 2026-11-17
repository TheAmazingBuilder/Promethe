/**
 * Zod schemas for the Playbook module (Phase 2) — client-safe, zod only.
 *
 * Bounds follow Euforia's playbook schemas (packages/shared/src/schemas/
 * playbook.ts + playbook-blocks.ts): names ≤ 80/120, markdown ≤ 8000,
 * 24 items max per list, short text fields ≤ 400.
 */
import { z } from "zod";

// ── Enums (Euforia playbook-blocks) ─────────────────────────────────────────

export const MARKET_CONDITIONS_PLAYBOOK = [
  "TRENDING",
  "RANGING",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "EXPANSION",
  "COMPRESSION",
  "BULLISH_STRUCTURE",
  "BEARISH_STRUCTURE",
  "NEUTRAL_STRUCTURE",
] as const;

export const ENTRY_CONDITION_CATEGORIES = [
  "MARKET_STRUCTURE",
  "PRICE_ACTION",
  "INDICATOR",
  "SESSION",
  "VOLATILITY",
  "ECONOMIC_EVENT",
  "TIME",
  "CUSTOM",
] as const;

export const CONFIRMATION_TYPES = [
  "CANDLE_CLOSE",
  "BREAK_OF_STRUCTURE",
  "RETEST",
  "VOLUME_CONFIRMATION",
  "MOMENTUM_CONFIRMATION",
  "INDICATOR_CONFIRMATION",
  "MULTI_TIMEFRAME_CONFIRMATION",
] as const;

export const EXIT_TYPES = [
  "TAKE_PROFIT",
  "STOP_LOSS",
  "PARTIAL_EXIT",
  "TIME_EXIT",
  "STRUCTURE_EXIT",
  "INDICATOR_EXIT",
  "MANUAL_EXIT",
  "INVALIDATED_SETUP",
] as const;

export const PLAYBOOK_RULE_CATEGORIES = [
  "RISK",
  "SESSION",
  "NEWS",
  "BEHAVIOR",
  "EXECUTION",
  "CUSTOM",
] as const;

export const PLAYBOOK_SESSIONS = [
  "ASIA",
  "LONDON",
  "NEW_YORK",
  "OVERLAP_LN_NY",
  "OTHER",
] as const;

export const TRADING_DAYS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;

export const STRATEGY_GRADES = ["A+", "A", "B", "C"] as const;

export const STRATEGY_STATUSES = [
  "ACTIVE",
  "TESTING",
  "DRAFT",
  "PAUSED",
  "ARCHIVED",
] as const;

export const PLAYBOOK_MATCHES = ["MATCHED", "PARTIAL", "OFF_PLAYBOOK"] as const;

// ── Structured strategy blocks (Euforia playbook-blocks) ───────────────────

export const marketProfileSchema = z.object({
  assetClass: z.string().trim().max(40).nullish(),
  symbols: z.array(z.string().trim().max(24)).max(30).default([]),
  market: z.string().trim().max(80).nullish(),
  accountLabel: z.string().trim().max(80).nullish(),
  timeframe: z.string().trim().max(16).nullish(),
  tradingStyle: z.string().trim().max(40).nullish(),
  sessions: z.array(z.enum(PLAYBOOK_SESSIONS)).max(10).default([]),
  tradingDays: z.array(z.enum(TRADING_DAYS)).max(7).default([]),
});

export const entryConditionSchema = z.object({
  id: z.string().min(1).max(80),
  category: z.enum(ENTRY_CONDITION_CATEGORIES),
  text: z.string().trim().min(1, "required").max(400),
  /** Items sharing a group are ORed together; ungrouped items are ANDed. */
  group: z.string().trim().max(40).nullish(),
});

export const confirmationSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(CONFIRMATION_TYPES),
  note: z.string().trim().max(400).nullish(),
});

export const managementRuleSchema = z.object({
  id: z.string().min(1).max(80),
  trigger: z.string().trim().min(1, "required").max(200),
  action: z.string().trim().min(1, "required").max(200),
  condition: z.string().trim().max(200).nullish(),
});

export const exitRuleSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(EXIT_TYPES),
  rule: z.string().trim().min(1, "required").max(400),
});

export const strategyRiskSchema = z.object({
  defaultRiskPct: z.number().min(0).max(100).nullish(),
  maxRiskPct: z.number().min(0).max(100).nullish(),
  fixedRiskAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "invalidDecimal")
    .nullish(),
  stopMethodology: z.string().trim().max(400).nullish(),
  targetMethodology: z.string().trim().max(400).nullish(),
  minRR: z.number().min(0).max(100).nullish(),
  maxConcurrentTrades: z.number().int().min(1).max(99).nullish(),
  maxCorrelatedExposure: z.number().min(0).max(100).nullish(),
  dailyRiskRestriction: z.string().trim().max(400).nullish(),
  newsRestriction: z.string().trim().max(400).nullish(),
});

// ── Definition vs presentation (Euforia domain/strategy-versioning.ts) ──────

/**
 * The 13 definition fields whose change freezes a snapshot of the CURRENT
 * definition BEFORE the mutation, then bumps Strategy.version. Presentation
 * fields (name, status, grade, color, tags) mutate in place.
 */
export const STRATEGY_DEFINITION_FIELDS = [
  "description",
  "entryRules",
  "exitRules",
  "riskRules",
  "detailedDescription",
  "marketProfile",
  "marketConditions",
  "entryConditions",
  "confirmations",
  "invalidations",
  "risk",
  "tradeManagement",
  "exitPlan",
] as const;

export type StrategyDefinitionField =
  (typeof STRATEGY_DEFINITION_FIELDS)[number];

/** True when the patch mutates the strategy's methodology (freeze first). */
export function touchesDefinition(patch: Record<string, unknown>): boolean {
  return STRATEGY_DEFINITION_FIELDS.some(
    (field) => patch[field] !== undefined,
  );
}

// ── Setups ───────────────────────────────────────────────────────────────────

export const setupInputSchema = z.object({
  strategyId: z.string().min(1, "required"),
  name: z.string().trim().min(1, "required").max(120),
  description: z.string().trim().max(2000).nullish(),
  status: z.enum(STRATEGY_STATUSES).default("ACTIVE"),
  context: z.string().trim().max(4000).nullish(),
  marketCondition: z.enum(MARKET_CONDITIONS_PLAYBOOK).nullish(),
  trigger: z.string().trim().max(400).nullish(),
  confirmation: z.string().trim().max(400).nullish(),
  entryModel: z.string().trim().max(400).nullish(),
  stopModel: z.string().trim().max(400).nullish(),
  targetModel: z.string().trim().max(400).nullish(),
  /** When the setup is no longer valid — critical, never optional. */
  invalidation: z.string().trim().min(1, "required").max(400),
  notes: z.string().trim().max(4000).nullish(),
  tags: z.array(z.string().trim().max(24)).max(24).default([]),
});

export type SetupInput = z.infer<typeof setupInputSchema>;
export const setupPatchSchema = setupInputSchema
  .partial()
  .omit({ strategyId: true });
export type SetupPatch = z.infer<typeof setupPatchSchema>;

// ── Playbook rules ───────────────────────────────────────────────────────────

export const playbookRuleInputSchema = z.object({
  title: z.string().trim().min(1, "required").max(160),
  detail: z.string().trim().max(4000).default(""),
  category: z.enum(PLAYBOOK_RULE_CATEGORIES),
  scope: z.enum(["GLOBAL", "STRATEGY"]).default("GLOBAL"),
  strategyId: z.string().nullish(),
  evaluatable: z.boolean().default(false),
  evaluationHint: z.string().trim().max(200).nullish(),
  active: z.boolean().default(true),
});

export type PlaybookRuleInput = z.infer<typeof playbookRuleInputSchema>;
export const playbookRulePatchSchema = playbookRuleInputSchema.partial();
export type PlaybookRulePatch = z.infer<typeof playbookRulePatchSchema>;

// ── Checklist templates ──────────────────────────────────────────────────────

export const checklistTemplateItemSchema = z.object({
  label: z.string().trim().min(1, "required").max(200),
  required: z.boolean().default(true),
  category: z
    .enum(["ENTRY", "EXIT", "RISK", "CONTEXT"])
    .default("ENTRY"),
});

export const checklistTemplateInputSchema = z.object({
  /** Null = global template, usable with any strategy. */
  strategyId: z.string().nullish(),
  name: z.string().trim().min(1, "required").max(120),
  items: z.array(checklistTemplateItemSchema).min(1, "required").max(24),
});

export type ChecklistTemplateInput = z.infer<
  typeof checklistTemplateInputSchema
>;
export const checklistTemplatePatchSchema =
  checklistTemplateInputSchema.partial();
export type ChecklistTemplatePatch = z.infer<
  typeof checklistTemplatePatchSchema
>;

// ── Review: playbook match (declared, never derived) ────────────────────────

export const playbookMatchSchema = z.object({
  playbookMatch: z.enum(PLAYBOOK_MATCHES),
});

// ── Strategy templates (code-only content, never seeded in DB) ──────────────

export const instantiateTemplateSchema = z.object({
  key: z.string().min(1, "required").max(80),
  name: z.string().trim().min(1).max(80).optional(),
});

export const duplicateStrategySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});
