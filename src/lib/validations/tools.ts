/**
 * v2.5 Module 5 - trading tools: zod schemas for the /api/v1/* tools routes.
 */
import { z } from "zod";

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "invalidCurrency");

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, "invalidDecimal");

const positiveDecimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "invalidDecimal")
  .refine((v) => Number(v) > 0, "mustBePositive");

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalidTime");

const isoWeekday = z.number().int().min(1).max(7);

// ── Tool scenarios (multi-TP / margin / risk-reward / position-size / P&L simulator) ──

export const toolScenarioKindSchema = z.enum([
  "MULTI_TP",
  "MARGIN",
  "RISK_REWARD",
  "POSITION_SIZE",
  "PNL_SIMULATOR",
]);
export type ToolScenarioKind = z.infer<typeof toolScenarioKindSchema>;

export const toolScenarioInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  kind: toolScenarioKindSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type ToolScenarioInput = z.infer<typeof toolScenarioInputSchema>;

export const toolScenarioPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type ToolScenarioPatch = z.infer<typeof toolScenarioPatchSchema>;

// ── FX rates ─────────────────────────────────────────────────────────────────

export const fxRateInputSchema = z.object({
  base: currencyCode,
  quote: currencyCode,
  rate: positiveDecimalString,
  source: z.enum(["MANUAL", "CSV"]).default("MANUAL"),
  /** ISO date the rate applies to (default: today). */
  date: z.string().trim().min(1).max(10).optional(),
});
export type FxRateInput = z.infer<typeof fxRateInputSchema>;

export const fxRatePatchSchema = z.object({
  base: currencyCode.optional(),
  quote: currencyCode.optional(),
  rate: positiveDecimalString.optional(),
  date: z.string().trim().min(1).max(10).optional(),
});
export type FxRatePatch = z.infer<typeof fxRatePatchSchema>;

export const fxRatesImportSchema = z.object({
  /** Raw CSV text: `base,quote,taux` or `paire,taux` per line. */
  csv: z.string().min(1, "required").max(256_000),
});
export type FxRatesImportInput = z.infer<typeof fxRatesImportSchema>;

// ── Market session settings ──────────────────────────────────────────────────

const marketSessionSettingFields = {
  name: z.string().trim().min(1, "required").max(60),
  kind: z.enum(["DISPLAY", "DETECTION"]),
  timezone: z.string().trim().min(1).max(60),
  openTime: hhmm,
  closeTime: z
    .string()
    .regex(/^([01]\d|2[0-4]):[0-5]\d$/, "invalidTime"), // "24:00" allowed
  activeDays: z.array(isoWeekday).min(1).max(7),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
};

export const marketSessionSettingInputSchema = z.object(marketSessionSettingFields);
export type MarketSessionSettingInput = z.infer<typeof marketSessionSettingInputSchema>;

export const marketSessionSettingPatchSchema = z.object({
  name: marketSessionSettingFields.name.optional(),
  timezone: marketSessionSettingFields.timezone.optional(),
  openTime: marketSessionSettingFields.openTime.optional(),
  closeTime: marketSessionSettingFields.closeTime.optional(),
  activeDays: marketSessionSettingFields.activeDays.optional(),
  enabled: marketSessionSettingFields.enabled.optional(),
  sortOrder: marketSessionSettingFields.sortOrder.optional(),
});
export type MarketSessionSettingPatch = z.infer<typeof marketSessionSettingPatchSchema>;

// ── Exit plans ───────────────────────────────────────────────────────────────

const exitPlanTierSchema = z.object({
  pct: z.number().min(0).max(100),
  targetType: z.enum(["PRICE", "R"]),
  target: z.string().trim().regex(/^(?:\d+(?:\.\d*)?|\.\d+)$/).max(30),
});

const exitPlanFields = {
  name: z.string().trim().min(1, "required").max(80),
  tiers: z.array(exitPlanTierSchema).min(1).max(4),
  breakevenAfterTier: z.number().int().min(0).max(3).nullable(),
  trailingAfterTier: z.number().int().min(0).max(3).nullable(),
  notes: z.string().max(2000),
};

export const exitPlanInputSchema = z.object(exitPlanFields);
export type ExitPlanInput = z.infer<typeof exitPlanInputSchema>;

export const exitPlanPatchSchema = z.object({
  name: exitPlanFields.name.optional(),
  tiers: exitPlanFields.tiers.optional(),
  breakevenAfterTier: exitPlanFields.breakevenAfterTier.optional(),
  trailingAfterTier: exitPlanFields.trailingAfterTier.optional(),
  notes: exitPlanFields.notes.optional(),
});
export type ExitPlanPatch = z.infer<typeof exitPlanPatchSchema>;

// ── Exposure alert settings (singleton per user) ─────────────────────────────

export const exposureSettingsSchema = z.object({
  enabled: z.boolean(),
  duplicationThresholdPercent: decimalString,
  maxCurrencyExposurePercent: decimalString,
});
export type ExposureSettingsInput = z.infer<typeof exposureSettingsSchema>;
