/**
 * v2.5 Module 2 — chart domain Zod schemas (single source of truth).
 *
 * Shared by the chart-builder UI, the /api/charts/* routes and the pure
 * engines in /src/lib/charts/*. Client-safe: zod only. Conventions follow
 * the trade domain: decimals travel as STRINGS, dates as ISO strings,
 * SQLite has no enums so value sets live here as z.enum over the lib
 * constants.
 */
import { z } from "zod";
import { TIMEFRAMES } from "@/lib/trading/types";

// ── Candle timeframes (price charts) ─────────────────────────────────────────

/** Timeframes candles can be stored / displayed at (resampling happens in
 *  /src/lib/charts/price.ts from the finest available granularity). */
export const CANDLE_TIMEFRAMES = [
  "M1",
  "M5",
  "M15",
  "M30",
  "H1",
  "H4",
  "D1",
] as const;
export type CandleTimeframe = (typeof CANDLE_TIMEFRAMES)[number];
export const candleTimeframeSchema = z.enum(CANDLE_TIMEFRAMES);

/** Timeframe value in minutes (M1=1 … D1=1440). */
export const TF_MINUTES: Record<CandleTimeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
};

// ── Chart builder config (the SavedChart.configJson contract) ────────────────

/** Categorical / temporal X dimensions (see /src/lib/charts/builder.ts). */
export const X_DIMENSIONS = [
  "hourOfDay",
  "dayOfWeek",
  "dayOfMonth",
  "month",
  "week",
  "session",
  "instrument",
  "strategy",
  "direction",
  "timeframe",
  "setupType",
  "marketCondition",
  "emotionBefore",
  "emotionDuring",
  "emotionAfter",
  "tag",
  "mistake",
  "holdingTimeBucket",
  "lotSizeBucket",
  "riskPercentBucket",
  "confidence",
  "setupQuality",
  "followedPlan",
  "exitReason",
  "result",
  "account",
  "tradeIndex",
  "date",
] as const;
export type XDimension = (typeof X_DIMENSIONS)[number];

/** Numeric measures usable as scatter/histogram X. */
export const NUMERIC_X_MEASURES = [
  "rMultiple",
  "netPnl",
  "pips",
  "holdingTimeMin",
  "mfeR",
  "maeR",
  "lots",
  "riskPercent",
] as const;
export type NumericXMeasure = (typeof NUMERIC_X_MEASURES)[number];

/** Y measures (per-trade or per-category aggregates). */
export const Y_MEASURES = [
  "rMultiple",
  "netPnl",
  "pips",
  "points",
  "lots",
  "riskPercent",
  "winRate",
  "expectancy",
  "profitFactor",
  "tradeCount",
  "avgHoldingTime",
  "mfeR",
  "maeR",
] as const;
export type YMeasure = (typeof Y_MEASURES)[number];

export const AGGREGATIONS = [
  "sum",
  "avg",
  "median",
  "min",
  "max",
  "count",
  "percentile",
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const CHART_TYPES = [
  "bar",
  "line",
  "area",
  "scatter",
  "box",
  "histogram",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Series / color split (groupBy). */
export const GROUP_BYS = [
  "none",
  "direction",
  "result",
  "followedPlan",
] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const CHART_SORTS = [
  "natural",
  "valueDesc",
  "valueAsc",
  "keyAsc",
  "keyDesc",
] as const;
export type ChartSort = (typeof CHART_SORTS)[number];

export const chartConfigSchema = z
  .object({
    /** X dimension (categorical/temporal) — or numeric measure for scatter/histogram. */
    x: z.union([z.enum(X_DIMENSIONS), z.enum(NUMERIC_X_MEASURES)]),
    /** Y measure — omitted for histogram. */
    y: z.enum(Y_MEASURES).optional(),
    /** Aggregation of the per-trade Y values inside each X category. */
    aggregation: z.enum(AGGREGATIONS).optional(),
    /** 1-99 — required when aggregation = percentile. */
    percentile: z.number().int().min(1).max(99).optional(),
    chartType: z.enum(CHART_TYPES),
    groupBy: z.enum(GROUP_BYS).default("none"),
    sort: z.enum(CHART_SORTS).default("natural"),
    /** Keep only the top N categories by |value| (3-50). */
    topN: z.number().int().min(3).max(50).optional(),
    /** Categories below this sample size are greyed + excluded from trend. */
    minSampleSize: z.number().int().min(0).max(100).default(0),
    /** Scatter: least-squares trend line + R². */
    showTrendLine: z.boolean().default(false),
    /** Histogram bin count (5-60). */
    binCount: z.number().int().min(5).max(60).optional(),
    /** Optional second Y measure on the right axis (bar/line/area only). */
    y2: z.enum(Y_MEASURES).optional(),
    /** Saved filter context (period + account) — informational replay. */
    period: z.enum(["30d", "90d", "ytd", "all"]).default("all"),
    accountId: z.string().nullish(),
  })
  .superRefine((cfg, ctx) => {
    // histogram: numeric X measure, no Y/aggregation/groupBy/topN.
    if (cfg.chartType === "histogram") {
      if (!(NUMERIC_X_MEASURES as readonly string[]).includes(cfg.x)) {
        ctx.addIssue({
          code: "custom",
          message: "histogramRequiresNumericX",
        });
      }
      if (cfg.y != null || cfg.aggregation != null) {
        ctx.addIssue({ code: "custom", message: "histogramHasNoY" });
      }
      return;
    }

    // scatter: X numeric measure (or tradeIndex/date), Y per-trade measure, raw.
    if (cfg.chartType === "scatter") {
      const xOk =
        (NUMERIC_X_MEASURES as readonly string[]).includes(cfg.x) ||
        cfg.x === "tradeIndex" ||
        cfg.x === "date";
      if (!xOk) {
        ctx.addIssue({ code: "custom", message: "scatterRequiresNumericX" });
      }
      if (cfg.y == null) {
        ctx.addIssue({ code: "custom", message: "scatterRequiresY" });
      }
      if (cfg.aggregation != null && cfg.aggregation !== "count") {
        ctx.addIssue({ code: "custom", message: "scatterIsRaw" });
      }
      return;
    }

    // bar / line / area / box: categorical X + Y required.
    if ((NUMERIC_X_MEASURES as readonly string[]).includes(cfg.x)) {
      ctx.addIssue({ code: "custom", message: "categoricalChartRequiresDimensionX" });
    }
    if (cfg.y == null) {
      ctx.addIssue({ code: "custom", message: "requiresY" });
    }

    const y = cfg.y;
    const AGGREGATE_MEASURES: readonly string[] = [
      "winRate",
      "expectancy",
      "profitFactor",
      "tradeCount",
      "avgHoldingTime",
    ];
    const isAggregateY = y != null && AGGREGATE_MEASURES.includes(y);
    if (cfg.chartType === "box") {
      // Box plots show the raw distribution per category — no aggregation,
      // per-trade measures only.
      if (isAggregateY) {
        ctx.addIssue({ code: "custom", message: "boxRequiresPerTradeY" });
      }
      if (cfg.aggregation != null) {
        ctx.addIssue({ code: "custom", message: "boxTakesNoAggregation" });
      }
    } else if (isAggregateY) {
      // Aggregate measures are computed per category — no further aggregation.
      if (cfg.aggregation != null) {
        ctx.addIssue({ code: "custom", message: "aggregateMeasureTakesNoAggregation" });
      }
    } else {
      // Per-trade measures need an aggregation.
      if (cfg.aggregation == null) {
        ctx.addIssue({ code: "custom", message: "requiresAggregation" });
      }
      if (cfg.aggregation === "percentile" && cfg.percentile == null) {
        ctx.addIssue({ code: "custom", message: "requiresPercentile" });
      }
    }
    if (cfg.y2 != null && !["bar", "line", "area"].includes(cfg.chartType)) {
      ctx.addIssue({ code: "custom", message: "secondAxisOnlyOnBarLineArea" });
    }
    if (cfg.y2 != null && cfg.y2 === cfg.y) {
      ctx.addIssue({ code: "custom", message: "secondAxisMustDiffer" });
    }
  });

export type ChartConfig = z.infer<typeof chartConfigSchema>;

// ── Saved chart CRUD ─────────────────────────────────────────────────────────

export const savedChartInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80),
  config: chartConfigSchema,
});
export type SavedChartInput = z.infer<typeof savedChartInputSchema>;

export const savedChartPatchSchema = z.object({
  name: z.string().trim().min(1, "required").max(80).optional(),
  config: chartConfigSchema.optional(),
});
export type SavedChartPatch = z.infer<typeof savedChartPatchSchema>;

export const builderDataQuerySchema = z.object({
  period: z.enum(["30d", "90d", "ytd", "all"]).default("all"),
  account: z.string().optional(),
});
export type BuilderDataQuery = z.infer<typeof builderDataQuerySchema>;

// ── Annotations (tables exist since Phase 1 — UI ships in Phase 6) ───────────

export const ANNOTATION_KINDS = [
  "STRATEGY_CHANGE",
  "VACATION",
  "BAD_PERIOD",
  "NEWS",
  "RULE_CHANGE",
  "OTHER",
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANNOTATION_SCOPES = ["GLOBAL", "ACCOUNT", "STRATEGY"] as const;
export type AnnotationScope = (typeof ANNOTATION_SCOPES)[number];

const isoTs = z.string().datetime({ offset: true, message: "invalidDate" });

const annotationBaseSchema = z.object({
  date: isoTs,
  endDate: isoTs.nullish(),
  label: z.string().trim().min(1, "required").max(80),
  note: z.string().max(2000).nullish(),
  kind: z.enum(ANNOTATION_KINDS).default("OTHER"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "invalidColor")
    .nullish(),
  scope: z.enum(ANNOTATION_SCOPES).default("GLOBAL"),
  accountId: z.string().nullish(),
  strategyId: z.string().nullish(),
});

export const annotationInputSchema = annotationBaseSchema.superRefine(
  (a, ctx) => {
    if (a.scope === "ACCOUNT" && !a.accountId) {
      ctx.addIssue({ code: "custom", message: "requiresAccount" });
    }
    if (a.scope === "STRATEGY" && !a.strategyId) {
      ctx.addIssue({ code: "custom", message: "requiresStrategy" });
    }
    if (a.scope === "GLOBAL" && (a.accountId || a.strategyId)) {
      ctx.addIssue({ code: "custom", message: "globalTakesNoTarget" });
    }
    if (a.endDate && new Date(a.endDate).getTime() <= new Date(a.date).getTime()) {
      ctx.addIssue({ code: "custom", message: "endAfterStart" });
    }
  }
);
export type AnnotationInput = z.infer<typeof annotationInputSchema>;

/**
 * PATCH shape — plain partial (Zod v4 forbids .partial() after refinements).
 * The server merges the patch over the stored row and revalidates the FULL
 * object with annotationInputSchema, so cross-field rules still hold.
 */
export const annotationPatchSchema = annotationBaseSchema.partial();
export type AnnotationPatch = z.infer<typeof annotationPatchSchema>;

// ── Benchmark profiles (table exists since Phase 1 — UI ships in Phase 5) ────

export const BENCHMARK_TYPES = [
  "FIXED_PERCENT_PER_PERIOD",
  "FIXED_R_PER_PERIOD",
  "CUSTOM_SERIES",
] as const;
export type BenchmarkType = (typeof BENCHMARK_TYPES)[number];

export const BENCHMARK_PERIODS = ["MONTH", "WEEK", "YEAR"] as const;
export type BenchmarkPeriodUnit = (typeof BENCHMARK_PERIODS)[number];

const benchmarkParamsSchema = z
  .object({
    /** Percent per period, e.g. 1 = 1 %/month (FIXED_PERCENT_PER_PERIOD). */
    percent: z.number().min(0).max(100).optional(),
    /** R added per period (FIXED_R_PER_PERIOD). */
    rPerPeriod: z.number().min(0).max(1000).optional(),
    period: z.enum(BENCHMARK_PERIODS),
    compounding: z.boolean().default(true),
    /** ISO date — benchmark start (defaults to first trade). */
    startDate: isoTs.optional(),
    /** Base balance for FIXED_PERCENT (defaults to equity initial). */
    startBalance: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.percent == null && p.rPerPeriod == null) {
      ctx.addIssue({ code: "custom", message: "requiresRate" });
    }
  });

export const benchmarkInputSchema = z
  .object({
    name: z.string().trim().min(1, "required").max(80),
    type: z.enum(BENCHMARK_TYPES),
    params: benchmarkParamsSchema,
    /** CUSTOM_SERIES only: [{ date, value }] sorted ascending, ≤ 2000 points. */
    series: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          value: z.number().finite(),
        })
      )
      .max(2000)
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.type === "CUSTOM_SERIES" && (!b.series || b.series.length < 2)) {
      ctx.addIssue({ code: "custom", message: "requiresSeries" });
    }
    if (b.type !== "CUSTOM_SERIES" && b.series != null) {
      ctx.addIssue({ code: "custom", message: "seriesOnlyForCustom" });
    }
  });
export type BenchmarkInput = z.infer<typeof benchmarkInputSchema>;

// ── Candle payloads (Phase 3) ────────────────────────────────────────────────

export const candleWindowQuerySchema = z.object({
  instrumentId: z.string().min(1),
  timeframe: candleTimeframeSchema,
  from: isoTs,
  to: isoTs,
});
export type CandleWindowQuery = z.infer<typeof candleWindowQuerySchema>;

/** One candle as sent to the client (decimals as strings, time epoch ms UTC). */
export const candleDtoSchema = z.object({
  time: z.number().int(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string().nullable(),
});
export type CandleDTO = z.infer<typeof candleDtoSchema>;

export const candleImportSchema = z.object({
  instrumentId: z.string().min(1),
  timeframe: candleTimeframeSchema,
  /** Declared timezone of the CSV timestamps (IANA name or fixed offset). */
  timezone: z.string().min(1).max(64).default("UTC"),
  /** CSV text — header row with time/open/high/low/close(/volume) columns. */
  csv: z.string().min(1).max(8_000_000),
});
export type CandleImportInput = z.infer<typeof candleImportSchema>;

// Re-export for consumers that expect the union with TIMEFRAMES validation.
export const tradeTimeframeSchema = z.enum(TIMEFRAMES);
