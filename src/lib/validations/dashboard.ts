/**
 * Dashboard module — Zod validation schemas (v2.5 Module 1).
 *
 * Guards every dashboard API route: CRUD inputs, the batched data query,
 * appearance settings, custom metric definitions and the JSON import
 * payload (size-limited, unknown widget types rejected safely).
 */
import { z } from "zod";
import { KPI_KEYS, KPI_STRIP_MAX, PERIOD_PRESETS } from "@/lib/dashboard/types";

// ── Layouts & periods ────────────────────────────────────────────────────────

const widgetLayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
});

export const widgetLayoutsSchema = z
  .object({
    lg: widgetLayoutSchema.optional(),
    md: widgetLayoutSchema.optional(),
    sm: widgetLayoutSchema.optional(),
  })
  .strict();

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate");

export const periodOverrideSchema = z
  .object({
    mode: z.enum(["INHERIT", "PRESET", "ROLLING_DAYS", "ROLLING_TRADES", "CUSTOM"]),
    preset: z.enum(PERIOD_PRESETS).optional(),
    rollingDays: z.number().int().min(1).max(365).optional(),
    rollingTrades: z.number().int().min(1).max(1000).optional(),
    customFrom: isoDay.optional(),
    customTo: isoDay.optional(),
    compareToPrevious: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.mode !== "PRESET" ||
      (v.preset != null && (PERIOD_PRESETS as readonly string[]).includes(v.preset)),
    { message: "periodPresetRequired" }
  )
  .refine((v) => v.mode !== "ROLLING_DAYS" || v.rollingDays != null, {
    message: "rollingDaysRequired",
  })
  .refine((v) => v.mode !== "ROLLING_TRADES" || v.rollingTrades != null, {
    message: "rollingTradesRequired",
  })
  .refine(
    (v) =>
      v.mode !== "CUSTOM" ||
      (v.customFrom != null && v.customTo != null && v.customFrom <= v.customTo),
    { message: "customRangeInvalid" }
  );

// ── Dashboards ───────────────────────────────────────────────────────────────

export const dashboardCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    icon: z.string().trim().min(1).max(40).default("layout-dashboard"),
    /** Built-in template key — creates the widgets from the blueprint. */
    templateKey: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const dashboardPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    icon: z.string().trim().min(1).max(40).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "emptyPatch" });

export const dashboardsReorderSchema = z
  .object({
    order: z.array(z.string().min(1)).min(1).max(8),
  })
  .strict();

// ── Widgets ──────────────────────────────────────────────────────────────────

export const widgetCreateSchema = z
  .object({
    type: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(60).nullable().optional(),
    config: z.unknown().optional(),
    layouts: widgetLayoutsSchema.optional(),
    periodOverride: periodOverrideSchema.nullable().optional(),
    accountOverride: z.string().nullable().optional(),
  })
  .strict();

export const widgetPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(60).nullable().optional(),
    config: z.unknown().optional(),
    layouts: widgetLayoutsSchema.optional(),
    periodOverride: periodOverrideSchema.nullable().optional(),
    accountOverride: z.string().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "emptyPatch" });

// ── Batched data query ───────────────────────────────────────────────────────

export const dashboardDataQuerySchema = z
  .object({
    preset: z.enum(PERIOD_PRESETS).default("last30"),
    accountId: z.string().nullable().optional(),
  })
  .strict();

// ── Import / export ──────────────────────────────────────────────────────────

/** Max import payload size (bytes) — oversized files rejected safely. */
export const DASHBOARD_IMPORT_MAX_BYTES = 256 * 1024;

const importWidgetSchema = z
  .object({
    type: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(60).nullable().optional(),
    config: z.unknown().optional(),
    layouts: widgetLayoutsSchema.optional(),
    periodOverride: periodOverrideSchema.nullable().optional(),
  })
  .strict();

const importDashboardSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    icon: z.string().trim().min(1).max(40).optional(),
    widgets: z.array(importWidgetSchema).min(1).max(24),
  })
  .strict();

export const dashboardImportSchema = z
  .object({
    /** File format version — v1 since the module's first release. */
    version: z.literal(1),
    /** ISO production date of the export (informational). */
    exportedAt: z.string().max(40).optional(),
    dashboards: z.array(importDashboardSchema).min(1).max(8),
  })
  .strict();

export type DashboardImportPayload = z.infer<typeof dashboardImportSchema>;

// ── Template apply / save (routes) ───────────────────────────────────────────

export const templateApplySchema = z
  .object({
    /** Built-in template key to apply (replace mode). */
    templateKey: z.string().trim().min(1).max(40),
  })
  .strict();

export const templateSaveSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(280).nullable().optional(),
  })
  .strict();

// ── Custom metrics ───────────────────────────────────────────────────────────

const metricFilterField = z.enum([
  "instrument",
  "strategy",
  "session",
  "direction",
  "tag",
  "weekday",
  "hourRange",
  "emotion",
  "result",
  "account",
  "setupType",
]);

const metricFilterSchema = z
  .object({
    field: metricFilterField,
    /** IN semantics: trade matches when its value is in `values`. */
    values: z.array(z.string().min(1).max(60)).min(1).max(24),
  })
  .strict();

export const metricFilterGroupSchema = z
  .object({
    /** Filters inside a group combine with OR; groups combine with AND. */
    filters: z.array(metricFilterSchema).min(1).max(8),
  })
  .strict();

export const metricAggregateSchema = z.enum([
  "count",
  "winRate",
  "netPnl",
  "grossWin",
  "grossLoss",
  "avgPnl",
  "medianPnl",
  "avgR",
  "totalR",
  "profitFactor",
  "expectancyR",
  "expectancyCurrency",
  "totalPips",
  "avgLots",
  "avgDurationMin",
  "payoffRatio",
]);

/** Formula over sub-metrics — safe hand-written parser (see lib/metrics). */
export const metricFormulaSchema = z
  .object({
    /** Expression referencing A/B/C sub-metric names. */
    expression: z.string().trim().min(1).max(120),
    subMetrics: z
      .array(
        z
          .object({
            name: z.enum(["A", "B", "C"]),
            aggregate: metricAggregateSchema,
            filterGroups: z.array(metricFilterGroupSchema).max(6).default([]),
          })
          .strict()
      )
      .min(1)
      .max(3),
  })
  .strict();

export const customMetricInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(280).nullable().optional(),
    definition: z
      .object({
        aggregate: metricAggregateSchema,
        filterGroups: z.array(metricFilterGroupSchema).max(6).default([]),
        formula: metricFormulaSchema.nullable().optional(),
      })
      .strict(),
    format: z.enum(["NUMBER", "CURRENCY", "PERCENT", "R", "PIPS", "DURATION"]),
  })
  .strict();

export const customMetricPatchSchema = customMetricInputSchema.partial().strict();

export type MetricAggregate = z.infer<typeof metricAggregateSchema>;
export type MetricFilterGroupInput = z.infer<typeof metricFilterGroupSchema>;

// ── Appearance ───────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalidColor");

export const appearanceInputSchema = z
  .object({
    paletteKey: z
      .enum([
        "default",
        "colorblind",
        "deuteranopia",
        "protanopia",
        "monochrome",
        "high-contrast",
        "custom",
      ])
      .optional(),
    gainColor: hexColor.nullable().optional(),
    lossColor: hexColor.nullable().optional(),
    neutralColor: hexColor.nullable().optional(),
    density: z.enum(["COMPACT", "COMFORTABLE", "SPACIOUS"]).optional(),
    chartPaletteKey: z
      .enum(["default", "colorblind", "monochrome", "vivid"])
      .optional(),
    kpiDefaults: z
      .object({
        kpis: z.array(z.enum(KPI_KEYS)).max(KPI_STRIP_MAX).optional(),
        showDelta: z.boolean().optional(),
        showSparkline: z.boolean().optional(),
      })
      .strict()
      .optional(),
    focusModeConfig: z
      .object({
        hideAmounts: z.boolean().optional(),
        blocks: z
          .array(
            z.enum([
              "rules",
              "risk",
              "prop",
              "openTrades",
              "session",
              "actions",
              "planNote",
            ])
          )
          .max(7)
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type CustomMetricInput = z.infer<typeof customMetricInputSchema>;
export type CustomMetricPatch = z.infer<typeof customMetricPatchSchema>;
export type AppearanceInput = z.infer<typeof appearanceInputSchema>;
export type WidgetCreateInput = z.infer<typeof widgetCreateSchema>;
export type WidgetPatchInput = z.infer<typeof widgetPatchSchema>;
export type DashboardCreate = z.infer<typeof dashboardCreateSchema>;
export type DashboardPatch = z.infer<typeof dashboardPatchSchema>;
export type DashboardDataQuery = z.infer<typeof dashboardDataQuerySchema>;
