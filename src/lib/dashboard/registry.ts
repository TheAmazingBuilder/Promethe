/**
 * Dashboard module — widget registry (v2.5 Module 1, spec §4.1).
 *
 * The single extension point: every widget declares its identity, sizing,
 * Zod config schema, defaults and feature prerequisites here. Later modules
 * (heatmaps, exposure, trader score) call registerWidget() without touching
 * the dashboard core. Unknown types render a graceful placeholder.
 *
 * Client-safe: no Prisma / server imports (loaders live in
 * src/server/dashboard-data.ts and are resolved by widget type).
 */
import { z } from "zod";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CalendarDays,
  CandlestickChart,
  ChartColumn,
  Clock,
  Flame,
  Gauge,
  Goal,
  LineChart,
  ListChecks,
  Newspaper,
  NotebookPen,
  Plug,
  Rows3,
  Sigma,
  StickyNote,
  Table2,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { KPI_KEYS, KPI_STRIP_MAX, type WidgetType } from "./types";

// ── Config schemas (Zod v4) ──────────────────────────────────────────────────

const kpiKeySchema = z.enum(KPI_KEYS);

export const kpiStripConfigSchema = z.object({
  kpis: z.array(kpiKeySchema).min(1).max(KPI_STRIP_MAX),
  showDelta: z.boolean().default(false),
  showSparkline: z.boolean().default(false),
});

export const singleKpiConfigSchema = z.object({
  kpi: kpiKeySchema,
  showDelta: z.boolean().default(false),
});

export const pnlCalendarConfigSchema = z.object({
  months: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

export const recentTradesConfigSchema = z.object({
  limit: z.number().int().min(3).max(12).default(6),
});

export const tableLimitConfigSchema = z.object({
  limit: z.number().int().min(3).max(12).default(6),
});

export const nextNewsConfigSchema = z.object({
  limit: z.number().int().min(3).max(10).default(5),
});

export const stickyNoteConfigSchema = z.object({
  markdown: z.string().max(4000).default(""),
});

export const customMetricConfigSchema = z.object({
  metricId: z.string().min(1),
});

export const periodCompareConfigSchema = z.object({
  metric: z
    .enum(["netPnl", "winRate", "tradeCount", "profitFactor"])
    .default("netPnl"),
});

const emptyConfigSchema = z.object({}).strict();

// ── Definitions ──────────────────────────────────────────────────────────────

export type WidgetCategory =
  | "performance"
  | "trading"
  | "analysis"
  | "process"
  | "system";

export type WidgetRequirement =
  | "prop" // an active prop challenge
  | "news" // economic events data
  | "sync" // broker connections
  | "goals" // goals or rules configured
  | "metrics" // at least one custom metric saved
  | "savedCharts"; // v2.5 M2 - at least one saved chart

export interface WidgetDefinition {
  type: WidgetType;
  category: WidgetCategory;
  /** Absolute i18n key (dashboards.registry.<key>). */
  nameKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** Default footprint on the 12-col grid. */
  defaultLayout: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
  configSchema: z.ZodType;
  defaultConfig: unknown;
  /** Feature prerequisites - catalog disables the widget with a reason. */
  requires?: readonly WidgetRequirement[];
  /** false for purely static widgets (no loader call, no data payload). */
  hasLoader: boolean;
}

const def = (d: WidgetDefinition): WidgetDefinition => d;

const BUILT_INS: WidgetDefinition[] = [
  def({
    type: "kpi-strip",
    category: "performance",
    nameKey: "dashboards.registry.kpiStrip",
    descriptionKey: "dashboards.registry.kpiStripDesc",
    icon: Rows3,
    defaultLayout: { w: 12, h: 6 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
    configSchema: kpiStripConfigSchema,
    defaultConfig: {
      kpis: [
        "netPnl",
        "winRate",
        "profitFactor",
        "expectancyR",
        "tradeCount",
        "maxDrawdown",
        "currentStreak",
        "tradingDays",
      ],
      showDelta: false,
      showSparkline: false,
    },
    hasLoader: true,
  }),
  def({
    type: "single-kpi",
    category: "performance",
    nameKey: "dashboards.registry.singleKpi",
    descriptionKey: "dashboards.registry.singleKpiDesc",
    icon: Gauge,
    defaultLayout: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
    configSchema: singleKpiConfigSchema,
    defaultConfig: { kpi: "netPnl", showDelta: false },
    hasLoader: true,
  }),
  def({
    type: "equity-curve",
    category: "performance",
    nameKey: "dashboards.registry.equityCurve",
    descriptionKey: "dashboards.registry.equityCurveDesc",
    icon: LineChart,
    defaultLayout: { w: 8, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "drawdown-curve",
    category: "performance",
    nameKey: "dashboards.registry.drawdownCurve",
    descriptionKey: "dashboards.registry.drawdownCurveDesc",
    icon: TrendingDown,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "pnl-calendar",
    category: "performance",
    nameKey: "dashboards.registry.pnlCalendar",
    descriptionKey: "dashboards.registry.pnlCalendarDesc",
    icon: CalendarDays,
    defaultLayout: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
    maxSize: { w: 8, h: 8 },
    configSchema: pnlCalendarConfigSchema,
    defaultConfig: { months: 1 },
    hasLoader: true,
  }),
  def({
    type: "period-compare",
    category: "performance",
    nameKey: "dashboards.registry.periodCompare",
    descriptionKey: "dashboards.registry.periodCompareDesc",
    icon: TrendingUp,
    defaultLayout: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 3 },
    configSchema: periodCompareConfigSchema,
    defaultConfig: { metric: "netPnl" },
    hasLoader: true,
  }),
  def({
    type: "open-trades",
    category: "trading",
    nameKey: "dashboards.registry.openTrades",
    descriptionKey: "dashboards.registry.openTradesDesc",
    icon: Wallet,
    defaultLayout: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "recent-trades",
    category: "trading",
    nameKey: "dashboards.registry.recentTrades",
    descriptionKey: "dashboards.registry.recentTradesDesc",
    icon: CandlestickChart,
    defaultLayout: { w: 6, h: 6 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 12 },
    configSchema: recentTradesConfigSchema,
    defaultConfig: { limit: 6 },
    hasLoader: true,
  }),
  def({
    type: "quick-actions",
    category: "trading",
    nameKey: "dashboards.registry.quickActions",
    descriptionKey: "dashboards.registry.quickActionsDesc",
    icon: Zap,
    defaultLayout: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    maxSize: { w: 6, h: 6 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  }),
  def({
    type: "session-performance",
    category: "analysis",
    nameKey: "dashboards.registry.sessionPerformance",
    descriptionKey: "dashboards.registry.sessionPerformanceDesc",
    icon: Clock,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "weekday-performance",
    category: "analysis",
    nameKey: "dashboards.registry.weekdayPerformance",
    descriptionKey: "dashboards.registry.weekdayPerformanceDesc",
    icon: CalendarDays,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "hour-performance",
    category: "analysis",
    nameKey: "dashboards.registry.hourPerformance",
    descriptionKey: "dashboards.registry.hourPerformanceDesc",
    icon: Clock,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "strategy-table",
    category: "analysis",
    nameKey: "dashboards.registry.strategyTable",
    descriptionKey: "dashboards.registry.strategyTableDesc",
    icon: Target,
    defaultLayout: { w: 6, h: 6 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 12 },
    configSchema: tableLimitConfigSchema,
    defaultConfig: { limit: 6 },
    hasLoader: true,
  }),
  def({
    type: "instrument-table",
    category: "analysis",
    nameKey: "dashboards.registry.instrumentTable",
    descriptionKey: "dashboards.registry.instrumentTableDesc",
    icon: Table2,
    defaultLayout: { w: 6, h: 6 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 12 },
    configSchema: tableLimitConfigSchema,
    defaultConfig: { limit: 6 },
    hasLoader: true,
  }),
  def({
    type: "r-histogram",
    category: "analysis",
    nameKey: "dashboards.registry.rHistogram",
    descriptionKey: "dashboards.registry.rHistogramDesc",
    icon: ChartColumn,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "win-loss",
    category: "analysis",
    nameKey: "dashboards.registry.winLoss",
    descriptionKey: "dashboards.registry.winLossDesc",
    icon: Sigma,
    defaultLayout: { w: 4, h: 4 },
    minSize: { w: 2, h: 3 },
    maxSize: { w: 8, h: 6 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "streak",
    category: "analysis",
    nameKey: "dashboards.registry.streak",
    descriptionKey: "dashboards.registry.streakDesc",
    icon: Flame,
    defaultLayout: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "custom-metric",
    category: "analysis",
    nameKey: "dashboards.registry.customMetric",
    descriptionKey: "dashboards.registry.customMetricDesc",
    icon: Sigma,
    defaultLayout: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 8, h: 4 },
    configSchema: customMetricConfigSchema,
    defaultConfig: { metricId: "" },
    requires: ["metrics"],
    hasLoader: true,
  }),
  def({
    type: "goals-progress",
    category: "process",
    nameKey: "dashboards.registry.goalsProgress",
    descriptionKey: "dashboards.registry.goalsProgressDesc",
    icon: Goal,
    defaultLayout: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    requires: ["goals"],
    hasLoader: true,
  }),
  def({
    type: "journal-prompt",
    category: "process",
    nameKey: "dashboards.registry.journalPrompt",
    descriptionKey: "dashboards.registry.journalPromptDesc",
    icon: NotebookPen,
    defaultLayout: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 8, h: 5 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "review-queue",
    category: "process",
    nameKey: "dashboards.registry.reviewQueue",
    descriptionKey: "dashboards.registry.reviewQueueDesc",
    icon: ListChecks,
    defaultLayout: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 8, h: 5 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    hasLoader: true,
  }),
  def({
    type: "next-news",
    category: "process",
    nameKey: "dashboards.registry.nextNews",
    descriptionKey: "dashboards.registry.nextNewsDesc",
    icon: Newspaper,
    defaultLayout: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 8, h: 8 },
    configSchema: nextNewsConfigSchema,
    defaultConfig: { limit: 5 },
    requires: ["news"],
    hasLoader: true,
  }),
  def({
    type: "prop-status",
    category: "system",
    nameKey: "dashboards.registry.propStatus",
    descriptionKey: "dashboards.registry.propStatusDesc",
    icon: AlertTriangle,
    defaultLayout: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    requires: ["prop"],
    hasLoader: true,
  }),
  def({
    type: "sync-status",
    category: "system",
    nameKey: "dashboards.registry.syncStatus",
    descriptionKey: "dashboards.registry.syncStatusDesc",
    icon: Plug,
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    requires: ["sync"],
    hasLoader: true,
  }),
  def({
    type: "sticky-note",
    category: "system",
    nameKey: "dashboards.registry.stickyNote",
    descriptionKey: "dashboards.registry.stickyNoteDesc",
    icon: StickyNote,
    defaultLayout: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 12, h: 12 },
    configSchema: stickyNoteConfigSchema,
    defaultConfig: { markdown: "" },
    hasLoader: false,
  }),
];

// ── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY = new Map<WidgetType, WidgetDefinition>(
  BUILT_INS.map((d) => [d.type, d])
);

/** Extension point - later modules add widgets without touching the core. */
export function registerWidget(definition: WidgetDefinition): void {
  REGISTRY.set(definition.type, definition);
}

export function getWidgetDefinition(
  type: string
): WidgetDefinition | undefined {
  return REGISTRY.get(type as WidgetType);
}

export function getAllWidgetDefinitions(): WidgetDefinition[] {
  return [...REGISTRY.values()];
}

export const WIDGET_CATEGORY_KEYS = [
  "performance",
  "trading",
  "analysis",
  "process",
  "system",
] as const;

/** Validate + apply defaults to a config payload for a widget type. */
export function safeParseWidgetConfig(
  type: string,
  config: unknown
): { ok: true; config: unknown } | { ok: false } {
  const definition = getWidgetDefinition(type);
  if (!definition) return { ok: false };
  const result = definition.configSchema.safeParse(config ?? {});
  return result.success ? { ok: true, config: result.data } : { ok: false };
}
