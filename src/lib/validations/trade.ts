/**
 * Zod schemas for the trade domain — shared by the client forms and the API
 * routes (single source of truth). Client-safe: imports zod only.
 *
 * Conventions:
 *  - Decimal values travel as STRINGS (exact round-trip with decimal.js).
 *  - Messages are stable CODES translated client-side (src/lib/i18n-errors.ts).
 */
import { z } from "zod";
import { TRADE_GRADES } from "@/lib/trading/grades";
import { tradeLevelIssues } from "@/lib/trading/calculate";
import {
  ASSET_CLASSES,
  COMMON_CURRENCIES,
  DIRECTIONS,
  ORDER_TYPES,
  TRADE_STATUSES,
  TIMEFRAMES,
  TRADING_SESSIONS,
  EXIT_REASONS,
  EMOTIONS,
  MARKET_CONDITIONS,
} from "@/lib/trading/types";
import {
  confirmationSchema,
  entryConditionSchema,
  exitRuleSchema,
  managementRuleSchema,
  marketProfileSchema,
  strategyRiskSchema,
  MARKET_CONDITIONS_PLAYBOOK,
  STRATEGY_GRADES,
  STRATEGY_STATUSES,
} from "@/lib/validations/playbook";

// ── Primitives ───────────────────────────────────────────────────────────────

/** Non-negative decimal string ("0", "0.5", "2345.10"). */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "invalidDecimal");

/** IANA timezone name (Intl-accepted). No import: Intl is available in
 * browsers and Node, and this file stays dependency-free (zod only). */
const ianaTimezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "invalidTimezone");

/** Signed decimal string ("-12.5", "0", "340"). */
const signedDecimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, "invalidDecimal");

const optionalDecimal = decimalString.nullish();
const optionalSignedDecimal = signedDecimalString.nullish();

const isoDate = z.string().datetime({ offset: true, message: "invalidDate" });

// ── Trade create / update ────────────────────────────────────────────────────

/**
 * Base trade object. Kept separate from the refined create schema below:
 * Zod v4 forbids `.partial()` on schemas carrying refinements, and the
 * PATCH schema must stay partial (merged server-side, see updateTrade).
 */
const tradeInputObject = z.object({
  accountId: z.string().min(1, "required"),
  strategyId: z.string().nullish(),
  instrumentId: z.string().min(1, "required"),

  direction: z.enum(DIRECTIONS, "required"),
  orderType: z.enum(ORDER_TYPES).default("MARKET"),
  status: z.enum(TRADE_STATUSES).default("OPEN"),
  timeframe: z.enum(TIMEFRAMES).nullish(),
  session: z.enum(TRADING_SESSIONS).nullish(), // auto-detected server-side when null
  setupType: z.string().trim().max(60).nullish(),
  /// Playbook setup (Phase 2). When set, setupType is kept as a free-text
  /// fallback for older trades; new trades prefer setupId.
  setupId: z.string().nullish(),
  marketCondition: z.enum(MARKET_CONDITIONS).nullish(),

  entryTime: isoDate,
  exitTime: isoDate.nullish(),
  entryPrice: decimalString,
  exitPrice: optionalDecimal,
  stopLoss: optionalDecimal,
  takeProfit: optionalDecimal,
  mfePrice: optionalDecimal,
  maePrice: optionalDecimal,

  lots: decimalString,
  riskPercent: optionalDecimal,
  riskAmount: optionalDecimal,
  plannedRiskPercent: optionalDecimal,
  quoteToAccountRate: optionalDecimal,
  // v2.5 Module 5 — attached exit plan + current price override.
  exitPlanId: z.string().max(64).nullish(),
  currentPrice: optionalDecimal,

  commission: signedDecimalString.default("0"),
  swap: signedDecimalString.default("0"),
  fees: signedDecimalString.default("0"),
  pnlSource: z.enum(["CALCULATED", "MANUAL"]).default("CALCULATED"),
  manualNetPnl: signedDecimalString.nullish(),

  exitReason: z.enum(EXIT_REASONS).nullish(),

  emotionBefore: z.enum(EMOTIONS).nullish(),
  emotionDuring: z.enum(EMOTIONS).nullish(),
  emotionAfter: z.enum(EMOTIONS).nullish(),
  confidence: z.number().int().min(1).max(5).nullish(),
  setupQualityRating: z.number().int().min(1).max(5).nullish(),
  executionRating: z.number().int().min(1).max(5).nullish(),
  followedPlan: z.boolean().nullish(),
  /** MRT setup grade (A+ | A | B | C), null = ungraded. Not a 1-5 score. */
  grade: z.enum(TRADE_GRADES).nullish(),

  tagIds: z.array(z.string()).max(30).default([]),
  checklistResults: z.record(z.string(), z.boolean()).nullish(),

  preTradeAnalysis: z.string().max(20000).default(""),
  postTradeReview: z.string().max(20000).default(""),
  notes: z.string().max(20000).nullish(),
  tradingViewUrl: z.string().url("invalidUrl").max(500).nullish().or(z.literal("")),

  reviewStatus: z.enum(["NOT_REVIEWED", "REVIEWED"]).default("NOT_REVIEWED"),
  isDraft: z.boolean().default(false),
  // v2.5 Module 4 — custom-field values, validated server-side against the
  // live definitions (unknown keys are dropped).
  customFields: z.record(z.string(), z.unknown()).nullish(),
  /// Offline idempotency key (v2 §4.2): the server dedupes on it.
  clientMutationId: z.string().max(64).nullish(),
  /// Optimistic-concurrency base (v2 §4.2): last updatedAt seen by the client.
  expectedUpdatedAt: isoDate.nullish(),
});

/**
 * Create schema: the base object + directional TP/SL validation (MD §3.2).
 * BUY requires TP above entry and SL below; SELL the reverse; entry ==
 * TP/SL is rejected too. A wrong-side level used to be stored silently
 * (plannedRR computed as null) — it is now rejected at the API with a
 * 422 VALIDATION carrying the issue code on the offending field
 * (TP_WRONG_SIDE / TP_EQUALS_ENTRY on takeProfit, SL_WRONG_SIDE /
 * SL_EQUALS_ENTRY on stopLoss). Historical trades are NOT migrated and
 * are NOT re-validated unless those fields are edited (see updateTrade).
 *
 * Manual P&L (MD §3.3): pnlSource MANUAL requires manualNetPnl in the
 * same payload — there is no separate manualNetPnl column (the manual
 * value IS the stored netPnl), so a MANUAL trade without a value would
 * silently fall back to the calculated P&L while keeping the MANUAL
 * label. The value is required whatever the status: an open MANUAL trade
 * stores its manual value as netPnl (see computeDerived), so until a
 * realized broker P&L exists the source must stay CALCULATED.
 */
export const tradeInputSchema = tradeInputObject.superRefine((v, ctx) => {
  for (const issue of tradeLevelIssues(
    v.direction,
    v.entryPrice,
    v.stopLoss ?? null,
    v.takeProfit ?? null
  )) {
    ctx.addIssue({
      code: "custom",
      message: issue,
      path: issue.startsWith("TP_") ? ["takeProfit"] : ["stopLoss"],
    });
  }
  if (v.pnlSource === "MANUAL" && (v.manualNetPnl == null || v.manualNetPnl.trim() === "")) {
    ctx.addIssue({
      code: "custom",
      message: "manualNetPnlRequired",
      path: ["manualNetPnl"],
    });
  }
});

export type TradeInput = z.infer<typeof tradeInputSchema>;

/** PATCH: everything optional, applied on top of the stored trade. */
export const tradePatchSchema = tradeInputObject.partial().superRefine((v, ctx) => {
  // Explicitly clearing the manual value while (staying) MANUAL would
  // leave a MANUAL label with no manual value. The server merged check
  // in updateTrade covers the remaining cases (switch to MANUAL without
  // a value, closing a MANUAL trade without one); the schema cannot see
  // the stored trade, so it only rejects the explicit clear it can see.
  if (v.pnlSource === "MANUAL" && v.manualNetPnl === null) {
    ctx.addIssue({
      code: "custom",
      message: "manualNetPnlRequired",
      path: ["manualNetPnl"],
    });
  }
});
export type TradePatch = z.infer<typeof tradePatchSchema>;

export const closeTradeSchema = z
  .object({
    exitPrice: decimalString,
    exitTime: isoDate.nullish(), // default: now (server-side)
    exitReason: z.enum(EXIT_REASONS).nullish(),
    commission: signedDecimalString.nullish(),
    swap: signedDecimalString.nullish(),
    fees: signedDecimalString.nullish(),
    quoteToAccountRate: optionalDecimal,
    pnlSource: z.enum(["CALCULATED", "MANUAL"]).nullish(),
    manualNetPnl: signedDecimalString.nullish(),
    clientMutationId: z.string().max(64).nullish(),
  })
  .superRefine((v, ctx) => {
    // An explicitly MANUAL close must carry its value. When pnlSource is
    // omitted the server carries the stored manual value of an already
    // MANUAL trade (see closeTrade) — that case is not visible here.
    if (v.pnlSource === "MANUAL" && (v.manualNetPnl == null || v.manualNetPnl.trim() === "")) {
      ctx.addIssue({
        code: "custom",
        message: "manualNetPnlRequired",
        path: ["manualNetPnl"],
      });
    }
  });

export type CloseTradeInput = z.infer<typeof closeTradeSchema>;

// ── List query ───────────────────────────────────────────────────────────────

export const tradeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(TRADE_STATUSES).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  resultType: z.enum(["WIN", "LOSS", "BREAKEVEN"]).optional(),
  reviewStatus: z.enum(["NOT_REVIEWED", "REVIEWED"]).optional(),
  session: z.enum(TRADING_SESSIONS).optional(),
  /** MRT setup grade filter; "UNGRADED" matches trades with no grade. */
  grade: z.enum([...TRADE_GRADES, "UNGRADED"] as const).optional(),
  /// v2.5 M2 drill-down — chart timeframe (M1…MN).
  timeframe: z.enum(TIMEFRAMES).optional(),
  accountId: z.string().optional(),
  strategyId: z.string().optional(),
  instrumentId: z.string().optional(),
  symbol: z.string().optional(),
  tagId: z.string().optional(),
  emotion: z.enum(EMOTIONS).optional(),
  dateFrom: z.string().optional(), // ISO
  dateTo: z.string().optional(),
  search: z.string().max(100).optional(),
  // v2.5 Module 4 — filter by a SELECT custom field (server matches the
  // exact JSON fragment "\"key\":\"value\"" in Trade.customFields).
  customFieldKey: z.string().max(60).optional(),
  customFieldValue: z.string().max(200).optional(),
  /// v2.5 M2 drill-down — local entry hour (0-23, user's timezone).
  entryHour: z.coerce.number().int().min(0).max(23).optional(),
  /// v2.5 M2 drill-down — local ISO weekday (1 = Monday … 7 = Sunday).
  entryWeekday: z.coerce.number().int().min(1).max(7).optional(),
  includeDrafts: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  sort: z
    .enum(["entryTime", "exitTime", "netPnl", "rMultiple", "createdAt"])
    .default("entryTime"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type TradeListQuery = z.infer<typeof tradeListQuerySchema>;

// ── Templates (v2 §4.1) ──────────────────────────────────────────────────────

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  strategyId: z.string().nullish(),
  instrumentId: z.string().nullish(),
  direction: z.enum(DIRECTIONS).nullish(),
  timeframe: z.enum(TIMEFRAMES).nullish(),
  session: z.enum(TRADING_SESSIONS).nullish(),
  orderType: z.enum(ORDER_TYPES).nullish(),
  defaultRiskPercent: optionalDecimal,
  defaultRiskAmount: optionalDecimal,
  defaultLots: optionalDecimal,
  defaultStopLossPips: optionalDecimal,
  defaultTakeProfitPips: optionalDecimal,
  defaultTagIds: z.array(z.string()).max(30).default([]),
  defaultChecklistItemIds: z.array(z.string()).max(50).default([]),
  prefilledNotes: z.string().max(20000).nullish(),
});

export type TemplateInput = z.infer<typeof templateInputSchema>;
export const templatePatchSchema = templateInputSchema.partial();
export type TemplatePatch = z.infer<typeof templatePatchSchema>;

// ── Strategies / accounts / tags (minimal CRUD for form selectors) ──────────

export const CHECKLIST_CATEGORIES = [
  "ENTRY",
  "EXIT",
  "RISK",
  "CONTEXT",
] as const;

/** Checklist item as sent by the client (id omitted - server assigns). */
export const checklistItemSchema = z.object({
  label: z.string().trim().min(1, "required").max(200),
  category: z.enum(CHECKLIST_CATEGORIES).default("ENTRY"),
  order: z.number().int().min(0).max(999).default(0),
  isRequired: z.boolean().default(true),
});

export const strategyInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  description: z.string().max(5000).nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "invalidColor")
    .default("#10b981"),
  status: z.enum(STRATEGY_STATUSES).default("ACTIVE"),
  timeframes: z.array(z.enum(TIMEFRAMES)).max(9).default([]),
  instruments: z.array(z.string().trim().max(24)).max(30).optional(),
  sessions: z.array(z.string().trim().max(40)).max(10).optional(),
  defaultRiskPercent: optionalDecimal,
  targetRR: optionalDecimal,
  entryRules: z.string().max(20000).nullish(),
  exitRules: z.string().max(20000).nullish(),
  riskRules: z.string().max(20000).nullish(),
  // ── Playbook (Phase 2) — grade/tags are presentation (no version bump);
  // the rest are definition fields (Euforia §17: freeze before mutation).
  grade: z.enum(STRATEGY_GRADES).nullish(),
  detailedDescription: z.string().max(8000).nullish(),
  tags: z.array(z.string().trim().max(24)).max(24).optional(),
  marketProfile: marketProfileSchema.nullish(),
  marketConditions: z
    .array(z.enum(MARKET_CONDITIONS_PLAYBOOK))
    .max(24)
    .optional(),
  entryConditions: z.array(entryConditionSchema).max(24).optional(),
  confirmations: z.array(confirmationSchema).max(24).optional(),
  invalidations: z.array(z.string().trim().max(400)).max(24).optional(),
  risk: strategyRiskSchema.nullish(),
  tradeManagement: z.array(managementRuleSchema).max(24).optional(),
  exitPlan: z.array(exitRuleSchema).max(24).optional(),
  /**
   * Replace-all semantics (v1 phase 5): the client sends the FULL list on
   * every write; the server rewrites the rows in a transaction. Omitted on
   * PATCH → checklist untouched.
   */
  checklistItems: z.array(checklistItemSchema).max(60).optional(),
});

/** POST /api/v1/strategies/[id]/versions - snapshot the current definition. */
export const strategyVersionSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  broker: z.string().max(80).nullish(),
  type: z.enum(["LIVE", "DEMO", "PROP", "BACKTEST"]).default("DEMO"),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "NZD", "JPY"]).default("USD"),
  initialBalance: decimalString.default("10000"),
  leverage: z.number().int().min(1).max(1000).nullish(),
  isActive: z.boolean().default(true),
  // PROP fields (used when type = PROP; v1 addendum §11.5)
  maxDailyLossPercent: optionalDecimal,
  maxTotalDrawdownPercent: optionalDecimal,
  profitTarget: optionalDecimal,
  // v2.5 Module 5 — margin call / stop-out levels in % (null = broker default).
  marginCallLevel: optionalDecimal,
  stopOutLevel: optionalDecimal,
  drawdownType: z.enum(["STATIC", "TRAILING"]).nullish(),
  startDate: isoDate.nullish(),
  // v2.5 Module 8 — broker server clock (IANA | FIXED_OFFSET | NY_CLOSE).
  serverTimezoneMode: z.enum(["IANA", "FIXED_OFFSET", "NY_CLOSE"]).nullish(),
  serverTimezone: ianaTimezone.nullish(),
  serverFixedOffsetMinutes: z.number().int().min(-720).max(840).nullish(),
});

export const tagInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "invalidColor")
    .default("#64748b"),
  kind: z.enum(["SETUP", "MISTAKE", "CONTEXT", "CUSTOM", "CONFLUENCE"]).default("CUSTOM"),
});
export const tagPatchSchema = tagInputSchema.partial();

// ── Custom instruments (v1 phase 7) ─────────────────────────────────────────

export const instrumentInputSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "required")
    .max(20)
    .regex(/^[A-Za-z0-9./_-]+$/, "invalidSymbol")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "required").max(80),
  assetClass: z.enum(ASSET_CLASSES),
  baseCurrency: z.enum(COMMON_CURRENCIES).nullish(),
  quoteCurrency: z.enum(COMMON_CURRENCIES).default("USD"),
  digits: z.number().int().min(0).max(10).default(5),
  /** Positive decimals - exact strings, never floats. */
  pipSize: decimalString.default("0.0001"),
  pointSize: decimalString.default("0.00001"),
  contractSize: decimalString.default("100000"),
  tickSize: decimalString.nullish(),
  tickValue: decimalString.nullish(),
  isActive: z.boolean().default(true),
  // v2.5 Module 8 — market timezone (IANA) for market-time display.
  marketTimezone: ianaTimezone.nullish(),
});
export const instrumentPatchSchema = instrumentInputSchema.partial();

// ── Saved views (v1 phase 3 — named filter presets) ─────────────────────────

export const savedViewInputSchema = z.object({
  page: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, "required").max(60),
  filters: z.record(z.string(), z.unknown()),
  // v2.5 Module 4 — full view state (all optional, filters-only stays valid).
  columns: z.array(z.string().min(1)).max(60).nullish(),
  sort: z
    .array(z.object({ id: z.string().min(1), desc: z.boolean() }))
    .max(10)
    .nullish(),
  grouping: z.record(z.string(), z.unknown()).nullish(),
  isPinned: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().int().min(0).max(100000).optional(),
});
