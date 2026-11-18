"use client";

/**
 * v2.5 Module 2 Phase 7 — chart dashboard widgets (spec §5).
 *
 * Three SELF-FETCHING widgets (hasLoader: false — the batched dashboard
 * payload is ignored): they pull their data through /api/charts/* and
 * /api/calendar/year with TanStack Query and reuse the Module 2 chart
 * engines/components wholesale (buildChart + ChartPreview, buildMatrix +
 * HeatmapMatrix, buildYearGrid + compact SVG).
 *
 * Every widget tolerates missing/broken config: empty states point to the
 * fix instead of crashing (the shell's error boundary is the last resort).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { LineChart as LineChartIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { useFormat } from "@/lib/format/use-format";
import {
  useBuilderData,
  useSavedCharts,
  parseSavedConfig,
} from "@/hooks/use-charts";
import {
  buildChart,
  drillToTradeFilters,
  type BuilderTrade,
  type ChartResult,
} from "@/lib/charts/builder";
import {
  buildMatrix,
  type HeatmapMetric,
  type MatrixResult,
} from "@/lib/charts/heatmap";
import {
  buildYearGrid,
  cellTone,
  metricScale,
  type YearCell,
  type YearDayStats,
} from "@/lib/charts/yearGrid";
import {
  ChartPreview,
  formatCategoryKey,
  yMeasureFormat,
  type MeasureFormatKind,
} from "@/components/charts/chart-preview";
import { HeatmapMatrix } from "@/components/charts/heatmap-matrix";
import {
  heatmapWidgetConfigSchema,
  savedChartWidgetConfigSchema,
} from "@/lib/dashboard/register-chart-widgets";
import type {
  ChartConfig,
  XDimension,
  YMeasure,
} from "@/lib/validations/charts";
import {
  NUMERIC_X_MEASURES,
  chartConfigSchema,
} from "@/lib/validations/charts";

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Drill-down → /trades?… (same contract as the full builder/heatmap views). */
function useDrill() {
  return React.useCallback(
    (drills: Array<{ dimension: XDimension; value: string }>) => {
      const parts: string[] = [];
      for (const d of drills) {
        const filters = drillToTradeFilters(d.dimension, d.value);
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null && value !== "") {
            parts.push(`${key}=${encodeURIComponent(String(value))}`);
          }
        }
      }
      navigate(parts.length > 0 ? `/trades?${parts.join("&")}` : "/trades");
    },
    []
  );
}

/** Scatter point click → open the trade (ChartPreview window event). */
function useTradeDrillEvent(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) navigate(`/trades/${encodeURIComponent(id)}`);
    };
    window.addEventListener("tj:chart-drill-trade", handler);
    return () => window.removeEventListener("tj:chart-drill-trade", handler);
  }, [enabled]);
}

function WidgetEmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 py-6 text-center">
      <LineChartIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint ? (
        <p className="max-w-xs text-xs text-muted-foreground/80">{hint}</p>
      ) : null}
      {action ? (
        <Button variant="outline" size="sm" className="mt-1" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

// ── Saved chart widget ───────────────────────────────────────────────────────

export function SavedChartWidget({
  config,
  heightPx,
}: {
  config: unknown;
  heightPx: number;
}) {
  const t = useTranslations("dashboards.charts");
  const { locale } = useI18n();
  const onDrill = useDrill();

  const parsedConfig = React.useMemo(
    () => savedChartWidgetConfigSchema.safeParse(config ?? {}),
    [config]
  );
  const chartId = parsedConfig.success ? parsedConfig.data.chartId : "";

  const savedCharts = useSavedCharts();
  const saved = React.useMemo(
    () => savedCharts.data?.find((c) => c.id === chartId) ?? null,
    [savedCharts.data, chartId]
  );

  // Validate the stored config — old/broken rows fall back to an error state.
  const chartConfig = React.useMemo(() => {
    if (!saved) return null;
    const raw = parseSavedConfig(saved.config);
    if (!raw) return null;
    const result = chartConfigSchema.safeParse(raw);
    return result.success ? (result.data as ChartConfig) : null;
  }, [saved]);

  // Honor the saved filter context (period + account).
  const data = useBuilderData({
    period: chartConfig?.period ?? "all",
    account: chartConfig?.accountId ?? null,
  });

  useTradeDrillEvent(chartConfig != null && (data.data?.trades.length ?? 0) > 0);

  const trades: BuilderTrade[] = data.data?.trades ?? [];
  const result: ChartResult | null = React.useMemo(() => {
    if (!chartConfig || !data.data || trades.length === 0) return null;
    try {
      return buildChart(trades, chartConfig);
    } catch {
      return null;
    }
  }, [chartConfig, data.data, trades]);

  if (savedCharts.isLoading || data.isLoading) {
    return <Skeleton className="h-full min-h-32 w-full" role="status" />;
  }

  if (!chartId) {
    return (
      <WidgetEmptyState title={t("noChart")} hint={t("noChartHint")} />
    );
  }
  if (!saved || !chartConfig) {
    return (
      <WidgetEmptyState title={t("chartDeleted")} hint={t("chartDeletedHint")} />
    );
  }
  if (trades.length === 0) {
    return <WidgetEmptyState title={t("noTrades")} hint={t("noTradesHint")} />;
  }
  if (!result) {
    return <WidgetEmptyState title={t("chartError")} hint={t("chartErrorHint")} />;
  }

  const xFmt = yMeasureFormat(
    (NUMERIC_X_MEASURES as readonly string[]).includes(chartConfig.x)
      ? (chartConfig.x as YMeasure)
      : undefined
  );

  return (
    <div style={{ height: Math.max(160, heightPx) }}>
      <ChartPreview
        result={result}
        config={chartConfig}
        currency={data.data?.currency ?? "USD"}
        xFormat={xFmt}
        yFormat={yMeasureFormat(chartConfig.y ?? undefined)}
        y2Format={yMeasureFormat(chartConfig.y2 ?? undefined)}
        onDrill={(d) => onDrill([d])}
        height={Math.max(160, heightPx)}
      />
    </div>
  );
}

// ── Heatmap widget ───────────────────────────────────────────────────────────

const METRIC_FORMAT: Record<HeatmapMetric, MeasureFormatKind> = {
  expectancyR: "R",
  netPnl: "CURRENCY",
  winRate: "PERCENT",
  profitFactor: "NUMBER",
  tradeCount: "NUMBER",
  avgR: "R",
};

export function HeatmapWidget({
  config,
  currency,
}: {
  config: unknown;
  currency: string;
}) {
  const t = useTranslations("dashboards.charts");
  const tBuckets = useTranslations("chartsBuilder.buckets");
  const { locale } = useI18n();
  const onDrill = useDrill();

  const parsedConfig = React.useMemo(
    () => heatmapWidgetConfigSchema.safeParse(config ?? {}),
    [config]
  );
  const cfg = parsedConfig.success
    ? parsedConfig.data
    : {
        rowDim: "dayOfWeek" as XDimension,
        colDim: "hourOfDay" as XDimension,
        metric: "expectancyR" as HeatmapMetric,
        minSampleSize: 5,
      };

  const data = useBuilderData({ period: "all", account: null });
  const trades: BuilderTrade[] = data.data?.trades ?? [];

  const result: MatrixResult | null = React.useMemo(() => {
    if (!data.data || trades.length === 0) return null;
    return buildMatrix(trades, cfg.rowDim, cfg.colDim, cfg.metric, {
      minSampleSize: cfg.minSampleSize,
      order: "natural",
    });
  }, [data.data, trades, cfg.rowDim, cfg.colDim, cfg.metric, cfg.minSampleSize]);

  const tBucket = React.useCallback((k: string) => tBuckets(k as never), [tBuckets]);

  if (data.isLoading) {
    return <Skeleton className="h-full min-h-32 w-full" role="status" />;
  }
  if (trades.length === 0 || !result) {
    return <WidgetEmptyState title={t("noTrades")} hint={t("noTradesHint")} />;
  }

  return (
    <div className="w-full">
      <HeatmapMatrix
        result={result}
        format={METRIC_FORMAT[cfg.metric]}
        currency={data.data?.currency ?? currency}
        locale={locale}
        onDrill={(drills) => onDrill(drills)}
        tBucket={tBucket}
      />
    </div>
  );
}

// ── Year calendar widget ─────────────────────────────────────────────────────

interface YearDaysPayload {
  year: number;
  currency: string;
  timezone: string;
  days: Record<string, YearDayStats>;
}

const YC_CELL = 11;
const YC_GAP = 2;
const YC_LABEL_W = 18;
const YC_MONTH_H = 14;

export function YearCalendarWidget() {
  const t = useTranslations("dashboards.charts");
  const tYear = useTranslations("chartsBuilder.yearCalendar");
  const fmt = useFormat();
  const { locale } = useI18n();
  const [focus, setFocus] = React.useState<{ row: number; col: number } | null>(
    null
  );

  const year = React.useMemo(() => new Date().getFullYear(), []);
  const data = useQuery({
    queryKey: ["calendar", "year", year],
    queryFn: async () => apiFetch<YearDaysPayload>(`/api/calendar/year?year=${year}`),
    staleTime: 5 * 60 * 1000,
  });

  // Week start per locale (en-US → Sunday=7, else Monday=1).
  const weekStart: 1 | 7 = locale.startsWith("en") ? 7 : 1;

  const stats = data.data?.days ?? {};
  const grid = React.useMemo(
    () => buildYearGrid(year, stats, weekStart),
    [year, stats, weekStart]
  );
  const scale = React.useMemo(() => metricScale(stats, "netPnl"), [stats]);
  const currency = data.data?.currency ?? "USD";

  if (data.isLoading) {
    return <Skeleton className="h-full min-h-32 w-full" role="status" />;
  }

  const hasData = Object.keys(stats).length > 0;
  if (!hasData) {
    return <WidgetEmptyState title={t("noTrades")} hint={t("noTradesHint")} />;
  }

  const weeks = grid.cells[0]?.length ?? 53;
  const width = YC_LABEL_W + weeks * (YC_CELL + YC_GAP) + 4;
  const height = YC_MONTH_H + 7 * (YC_CELL + YC_GAP) + 4;

  const fillOf = (cell: YearCell): { fill: string; opacity: number } => {
    const { tone, intensity } = cellTone(cell.stats, "netPnl", scale);
    if (tone === "muted") return { fill: "var(--muted)", opacity: 0.35 };
    if (tone === "neutral") return { fill: "var(--muted-foreground)", opacity: 0.3 };
    const pct = Math.round(intensity * 100);
    return {
      fill: `color-mix(in oklab, var(--${tone}) ${pct}%, var(--card))`,
      opacity: 1,
    };
  };

  const titleOf = (cell: YearCell): string => {
    if (!cell.inYear) return "";
    const s = cell.stats;
    return s
      ? tYear("cellPnl", {
          amount: fmt.money(s.netPnl, currency),
          count: s.tradeCount,
        })
      : tYear("cellEmpty");
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!focus) return;
    let { row, col } = focus;
    switch (e.key) {
      case "ArrowUp":
        row = Math.max(0, row - 1);
        break;
      case "ArrowDown":
        row = Math.min(6, row + 1);
        break;
      case "ArrowLeft":
        col = Math.max(0, col - 1);
        break;
      case "ArrowRight":
        col = Math.min(weeks - 1, col + 1);
        break;
      case "Enter":
      case " ": {
        const cell = grid.cells[focus.row]?.[focus.col];
        if (cell?.inYear) {
          e.preventDefault();
          navigate(`/journal/${cell.date}`);
        }
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    setFocus({ row, col });
  };

  const focusCell = focus ? grid.cells[focus.row]?.[focus.col] : null;

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={Math.max(width, 300)}
          style={{ minWidth: "100%" }}
          role="img"
          aria-label={t("yearTitle", { year })}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          {/* Month labels */}
          {grid.monthLabelCols.map(({ col, month }) => (
            <text
              key={month}
              x={YC_LABEL_W + col * (YC_CELL + YC_GAP)}
              y={10}
              fontSize={9}
              fill="var(--muted-foreground)"
            >
              {new Intl.DateTimeFormat(locale, { month: "short" }).format(
                new Date(2025, month - 1, 1)
              )}
            </text>
          ))}
          {/* Cells */}
          {grid.cells.map((weekRow, row) =>
            weekRow.map((cell, col) => {
              const { fill, opacity } = fillOf(cell);
              const isFocus = focus?.row === row && focus?.col === col;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={YC_LABEL_W + col * (YC_CELL + YC_GAP)}
                  y={YC_MONTH_H + row * (YC_CELL + YC_GAP)}
                  width={YC_CELL}
                  height={YC_CELL}
                  rx={2}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={isFocus ? "var(--ring)" : "transparent"}
                  strokeWidth={isFocus ? 1.5 : 0}
                  style={{ cursor: cell.inYear ? "pointer" : undefined }}
                  onMouseEnter={() => setFocus({ row, col })}
                  onClick={() => cell.inYear && navigate(`/journal/${cell.date}`)}
                >
                  <title>{titleOf(cell)}</title>
                </rect>
              );
            })
          )}
        </svg>
      </div>
      {/* Focus info (accessible, non-color) */}
      <div className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {focusCell?.inYear
          ? `${focusCell.date} - ${titleOf(focusCell)}`
          : tYear("hoverHint")}
      </div>
    </div>
  );
}
