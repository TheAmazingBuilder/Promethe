/**
 * v2.5 Module 2 — chart widget registration (spec §5/§7).
 *
 * Registers the new charts as dashboard widgets through the Module 1
 * extension point registerWidget() — the dashboard core is untouched.
 * All three are SELF-FETCHING (hasLoader: false): they pull their data
 * through the /api/v1/charts/* endpoints directly.
 *
 * Imported for its side effects by the widget catalog, the widget
 * renderer, the dashboards view, the server-side dashboard validation
 * and the registry unit tests.
 */
import { z } from "zod";
import { Grid3x3, LineChart, CalendarDays } from "lucide-react";
import { registerWidget } from "./registry";
import { HEATMAP_METRICS } from "@/lib/charts/heatmap";
import { X_DIMENSIONS, type XDimension } from "@/lib/validations/charts";

// ── Config schemas ───────────────────────────────────────────────────────────

/** Categorical dimensions usable on a heatmap axis (every X except tradeIndex). */
export const HEATMAP_DIM_KEYS = X_DIMENSIONS.filter(
  (d) => d !== "tradeIndex"
) as unknown as [XDimension, ...XDimension[]];

export const savedChartWidgetConfigSchema = z.object({
  /** SavedChart id - empty until the user picks one. */
  chartId: z.string().default(""),
});

export const heatmapWidgetConfigSchema = z.object({
  rowDim: z.enum(HEATMAP_DIM_KEYS).default("dayOfWeek"),
  colDim: z.enum(HEATMAP_DIM_KEYS).default("hourOfDay"),
  metric: z.enum(HEATMAP_METRICS).default("expectancyR"),
  minSampleSize: z.number().int().min(0).max(100).default(5),
});

export const yearCalendarWidgetConfigSchema = z.object({}).strict();

// ── Registration ─────────────────────────────────────────────────────────────

let registered = false;

/** Idempotent - imported for side effects by the catalog and the renderer. */
export function registerChartWidgets(): void {
  if (registered) return;
  registered = true;

  registerWidget({
    type: "saved-chart",
    category: "analysis",
    nameKey: "dashboards.registry.savedChart",
    descriptionKey: "dashboards.registry.savedChartDesc",
    icon: LineChart,
    defaultLayout: { w: 6, h: 8 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 12 },
    configSchema: savedChartWidgetConfigSchema,
    defaultConfig: { chartId: "" },
    requires: ["savedCharts"],
    hasLoader: false,
  });

  registerWidget({
    type: "heatmap",
    category: "analysis",
    nameKey: "dashboards.registry.heatmap",
    descriptionKey: "dashboards.registry.heatmapDesc",
    icon: Grid3x3,
    defaultLayout: { w: 6, h: 7 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 12 },
    configSchema: heatmapWidgetConfigSchema,
    defaultConfig: {
      rowDim: "dayOfWeek",
      colDim: "hourOfDay",
      metric: "expectancyR",
      minSampleSize: 5,
    },
    hasLoader: false,
  });

  registerWidget({
    type: "year-calendar",
    category: "performance",
    nameKey: "dashboards.registry.yearCalendar",
    descriptionKey: "dashboards.registry.yearCalendarDesc",
    icon: CalendarDays,
    defaultLayout: { w: 8, h: 7 },
    minSize: { w: 6, h: 5 },
    maxSize: { w: 12, h: 12 },
    configSchema: yearCalendarWidgetConfigSchema,
    defaultConfig: {},
    hasLoader: false,
  });
}

registerChartWidgets();
