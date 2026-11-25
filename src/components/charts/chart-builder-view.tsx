"use client";

/**
 * v2.5 Module 2 — chart builder page (/analytics/charts, spec §4.1).
 *
 * Dropdown-based builder with live preview: the pure engine (/src/lib/charts/
 * builder.ts) recomputes client-side over the cached trades payload, so every
 * config change is instant (no server round-trip). Features: presets, group-by
 * series, sample sizes + low-sample warnings, save/duplicate/delete saved
 * charts, CSV/PNG export, "view as table" fallback, click-to-drill-down into
 * the trades view.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  ChartColumn,
  Copy,
  Download,
  GitBranch,
  Image as ImageIcon,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Loader2,
  Plus,
  Save,
  ScatterChart,
  Table2,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import { useAddWidget, useDashboards } from "@/hooks/use-dashboards";
import {
  useBuilderData,
  useCreateSavedChart,
  useDeleteSavedChart,
  useSavedCharts,
  parseSavedConfig,
  type SavedChartDTO,
} from "@/hooks/use-charts";
import { useSession } from "@/components/app/session-context";
import { useI18n } from "@/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/ui/page-header";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { ApiClientError } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { getWidgetDefinition } from "@/lib/dashboard/registry";
// Registers the saved-chart / heatmap / year-calendar widgets (side effect).
import "@/lib/dashboard/register-chart-widgets";
import { findFreeSlot } from "@/lib/dashboard/layout";
import { MAX_WIDGETS_PER_DASHBOARD } from "@/lib/dashboard/types";
import {
  buildChart,
  chartResultToCsv,
  drillIsFilterable,
  drillToTradeFilters,
  measureDef,
  NUMERIC_X_DEFS,
  type BuilderTrade,
  type ChartResult,
} from "@/lib/charts/builder";
import {
  downloadTextFile,
  exportSvgToPng,
} from "@/lib/charts/export-png";
import {
  AGGREGATIONS,
  CHART_TYPES,
  chartConfigSchema,
  GROUP_BYS,
  NUMERIC_X_MEASURES,
  X_DIMENSIONS,
  Y_MEASURES,
  type Aggregation,
  type ChartConfig,
  type ChartSort,
  type ChartType,
  type GroupBy,
  type XDimension,
  type YMeasure,
} from "@/lib/validations/charts";
import dynamic from "next/dynamic";
import { ChartTable } from "./chart-table";
import {
  formatCategoryKey,
  yMeasureFormat,
} from "./chart-format";

// ChartPreview (recharts) loads on demand — the builder shell (filters,
// config, table fallback) renders first, the chart chunk after.
const ChartPreview = dynamic(
  () => import("./chart-preview").then((m) => m.ChartPreview),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[320px] w-full" />,
  }
);

// ── Config shape (draft — validated on every render) ─────────────────────────

interface DraftConfig {
  x: string;
  y: YMeasure | null;
  aggregation: Aggregation | null;
  percentile: number;
  chartType: ChartType;
  groupBy: GroupBy;
  sort: ChartSort;
  topN: number | null;
  minSampleSize: number;
  showTrendLine: boolean;
  binCount: number | null;
  y2: YMeasure | null;
  period: "30d" | "90d" | "ytd" | "all";
  accountId: string | null;
}

const DEFAULT_DRAFT: DraftConfig = {
  x: "hourOfDay",
  y: "rMultiple",
  aggregation: "avg",
  percentile: 75,
  chartType: "bar",
  groupBy: "none",
  sort: "natural",
  topN: null,
  minSampleSize: 0,
  showTrendLine: true,
  binCount: null,
  y2: null,
  period: "all",
  accountId: null,
};

const AGGREGATE_MEASURES: readonly string[] = [
  "winRate",
  "expectancy",
  "profitFactor",
  "tradeCount",
  "avgHoldingTime",
];

function toConfig(d: DraftConfig): ChartConfig | null {
  const candidate = {
    x: d.x,
    ...(d.y != null ? { y: d.y } : {}),
    ...(d.aggregation != null ? { aggregation: d.aggregation } : {}),
    ...(d.aggregation === "percentile" ? { percentile: d.percentile } : {}),
    chartType: d.chartType,
    groupBy: d.groupBy,
    sort: d.sort,
    ...(d.topN != null ? { topN: d.topN } : {}),
    minSampleSize: d.minSampleSize,
    showTrendLine: d.showTrendLine,
    ...(d.binCount != null ? { binCount: d.binCount } : {}),
    ...(d.y2 != null ? { y2: d.y2 } : {}),
    period: d.period,
    accountId: d.accountId,
  };
  const parsed = chartConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function configErrors(d: DraftConfig): string[] {
  const candidate = {
    x: d.x,
    ...(d.y != null ? { y: d.y } : {}),
    ...(d.aggregation != null ? { aggregation: d.aggregation } : {}),
    ...(d.aggregation === "percentile" ? { percentile: d.percentile } : {}),
    chartType: d.chartType,
    groupBy: d.groupBy,
    sort: d.sort,
    ...(d.topN != null ? { topN: d.topN } : {}),
    minSampleSize: d.minSampleSize,
    showTrendLine: d.showTrendLine,
    ...(d.binCount != null ? { binCount: d.binCount } : {}),
    ...(d.y2 != null ? { y2: d.y2 } : {}),
    period: d.period,
    accountId: d.accountId,
  };
  const parsed = chartConfigSchema.safeParse(candidate);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => String(i.message));
}

function fromConfig(c: ChartConfig): DraftConfig {
  return {
    x: c.x,
    y: c.y ?? null,
    aggregation: c.aggregation ?? null,
    percentile: c.percentile ?? 75,
    chartType: c.chartType,
    groupBy: c.groupBy,
    sort: c.sort,
    topN: c.topN ?? null,
    minSampleSize: c.minSampleSize,
    showTrendLine: c.showTrendLine,
    binCount: c.binCount ?? null,
    y2: c.y2 ?? null,
    period: c.period,
    accountId: c.accountId ?? null,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ChartBuilderView() {
  const t = useTranslations("chartsBuilder");
  const tRoot = useTranslations();
  const tPreview = useTranslations("chartsBuilder.preview");
  const tBuckets = useTranslations("chartsBuilder.buckets");
  const tCommon = useTranslations("common");
  const { locale } = useI18n();
  const { session } = useSession();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<DraftConfig>(DEFAULT_DRAFT);
  const [showTable, setShowTable] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [addTarget, setAddTarget] = React.useState<SavedChartDTO | null>(null);
  const [addDashboardId, setAddDashboardId] = React.useState("");
  // Set when "Add to dashboard" is clicked on an unsaved draft: the save
  // dialog opens first, then the freshly saved chart is added.
  const [pendingAddAfterSave, setPendingAddAfterSave] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement>(null);

  const accounts = useAccounts();
  const savedCharts = useSavedCharts();
  const createChart = useCreateSavedChart();
  const deleteChart = useDeleteSavedChart();
  const dashboardsQuery = useDashboards();
  const addWidget = useAddWidget();

  const filters = React.useMemo(
    () => ({ period: draft.period, account: draft.accountId }),
    [draft.period, draft.accountId]
  );
  const data = useBuilderData(filters);

  const config = React.useMemo(() => toConfig(draft), [draft]);
  const errors = React.useMemo(() => configErrors(draft), [draft]);

  const result: ChartResult | null = React.useMemo(() => {
    if (!config || !data.data) return null;
    try {
      return buildChart(data.data.trades, config);
    } catch {
      return null;
    }
  }, [config, data.data]);

  // Scatter point click → open the trade.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) navigate(`/trades/${encodeURIComponent(id)}`);
    };
    window.addEventListener("tj:chart-drill-trade", handler);
    return () => window.removeEventListener("tj:chart-drill-trade", handler);
  }, []);

  // ── Config setters with smart normalization ──────────────────────────────

  const setChartType = (chartType: ChartType) => {
    setDraft((d) => {
      const next: DraftConfig = { ...d, chartType };
      if (chartType === "histogram") {
        if (!(NUMERIC_X_MEASURES as readonly string[]).includes(d.x)) next.x = "rMultiple";
        next.y = null;
        next.aggregation = null;
        next.y2 = null;
      } else if (chartType === "scatter") {
        const xOk =
          (NUMERIC_X_MEASURES as readonly string[]).includes(d.x) ||
          d.x === "tradeIndex" ||
          d.x === "date";
        if (!xOk) next.x = "tradeIndex";
        if (d.y == null || AGGREGATE_MEASURES.includes(d.y)) next.y = "rMultiple";
        next.aggregation = null;
        next.y2 = null;
      } else {
        if ((NUMERIC_X_MEASURES as readonly string[]).includes(d.x)) next.x = "hourOfDay";
        if (d.y == null) next.y = "rMultiple";
        if (chartType === "box") {
          if (d.y != null && AGGREGATE_MEASURES.includes(d.y)) next.y = "rMultiple";
          next.aggregation = null;
          next.y2 = null;
        } else if (d.aggregation == null && d.y != null && !AGGREGATE_MEASURES.includes(d.y)) {
          next.aggregation = "avg";
        }
      }
      return next;
    });
  };

  const setX = (x: string) => {
    setDraft((d) => {
      const next: DraftConfig = { ...d, x };
      if (d.chartType === "bar" || d.chartType === "line" || d.chartType === "area") {
        if ((NUMERIC_X_MEASURES as readonly string[]).includes(x)) {
          // switching to a numeric X on a categorical chart → scatter is the sane default
          next.chartType = "scatter";
          next.aggregation = null;
        }
      }
      return next;
    });
  };

  const setY = (y: string) => {
    setDraft((d) => {
      const measure = y as YMeasure;
      const next: DraftConfig = { ...d, y: measure };
      if (AGGREGATE_MEASURES.includes(measure)) {
        next.aggregation = null;
      } else if (d.aggregation == null) {
        next.aggregation = "avg";
      }
      if (next.y2 === measure) next.y2 = null;
      return next;
    });
  };

  // ── Drill-down ────────────────────────────────────────────────────────────

  const onDrill = (drill: { dimension: XDimension; value: string }) => {
    const filtersMap = drillToTradeFilters(drill.dimension, drill.value);
    const keys = Object.entries(filtersMap)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (!keys) {
      toast({ description: t("preview.drillNotFilterable") });
      navigate("/trades");
      return;
    }
    navigate(`/trades?${keys}`);
  };

  // ── Exports ───────────────────────────────────────────────────────────────

  const exportCsv = () => {
    if (!result) return;
    downloadTextFile(chartResultToCsv(result), "chart-data.csv");
  };

  const exportPng = async () => {
    const ok = await exportSvgToPng(previewRef.current, "chart.png");
    if (!ok) toast({ description: t("preview.exportFailed") });
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const doSave = async (name: string, configOverride?: ChartConfig) => {
    const cfg = configOverride ?? config;
    if (!cfg || !name.trim()) return;
    setSaving(true);
    try {
      const created = await createChart.mutateAsync({
        name: name.trim(),
        config: cfg,
      });
      toast({ title: t("toast.saved") });
      setSaveOpen(false);
      setSaveName("");
      if (pendingAddAfterSave) {
        setPendingAddAfterSave(false);
        requestAddToDashboard(created);
      }
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const loadSaved = (sc: SavedChartDTO) => {
    const cfg = parseSavedConfig(sc.config);
    if (!cfg) {
      toast({ description: t("saved.brokenConfig"), variant: "destructive" });
      return;
    }
    setDraft(fromConfig(cfg));
  };

  const duplicateSaved = (sc: SavedChartDTO) => {
    const cfg = parseSavedConfig(sc.config);
    if (!cfg) return;
    void doSave(`${sc.name} (${t("saved.copySuffix")})`, cfg);
  };

  const removeSaved = async (sc: SavedChartDTO) => {
    try {
      await deleteChart.mutateAsync(sc.id);
      toast({ title: t("toast.deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    }
  };

  // ── Add to dashboard ────────────────────────────────────────────────────

  const dashboards = dashboardsQuery.data?.dashboards ?? [];

  /** Saved chart whose config matches the current draft, if any. */
  const matchingSaved = React.useMemo(() => {
    if (!config) return null;
    const current = JSON.stringify(config);
    return (
      (savedCharts.data ?? []).find((sc) => {
        const cfg = parseSavedConfig(sc.config);
        return cfg != null && JSON.stringify(cfg) === current;
      }) ?? null
    );
  }, [config, savedCharts.data]);

  /** Adds a saved chart as a saved-chart widget (same mechanism as the
   * widget catalog: registry default size + first free slot). */
  const addChartToDashboard = (chart: SavedChartDTO, dashboardId: string) => {
    const dashboard = dashboards.find((d) => d.id === dashboardId);
    if (!dashboard) return;
    if (dashboard.widgets.length >= MAX_WIDGETS_PER_DASHBOARD) {
      toast({ title: t("toast.dashboardFull"), variant: "destructive" });
      return;
    }
    const def = getWidgetDefinition("saved-chart");
    const w = def?.defaultLayout.w ?? 6;
    const h = def?.defaultLayout.h ?? 8;
    const existingLg = dashboard.widgets
      .map((wd) => wd.layouts.lg)
      .filter(
        (l): l is { x: number; y: number; w: number; h: number } => l != null
      );
    const slot = findFreeSlot(existingLg, w, h);
    setAddTarget(null);
    addWidget.mutate(
      {
        dashboardId,
        input: {
          type: "saved-chart",
          config: { chartId: chart.id },
          layouts: { lg: { x: slot.x, y: slot.y, w, h } },
        },
      },
      {
        onSuccess: () => {
          toast({
            title: t("toast.addedToDashboard", { dashboard: dashboard.name }),
            action: (
              <ToastAction
                altText={t("toast.viewDashboard")}
                onClick={() => navigate(`/?d=${dashboardId}`)}
              >
                {t("toast.viewDashboard")}
              </ToastAction>
            ),
          });
        },
        onError: (error) => {
          toast({
            title: t("toast.addError"),
            description: (error as Error | undefined)?.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  /** Entry point: one dashboard goes straight in, several open the picker. */
  const requestAddToDashboard = (chart: SavedChartDTO) => {
    if (dashboards.length === 0) {
      toast({ title: t("toast.noDashboard"), variant: "destructive" });
      return;
    }
    if (dashboards.length === 1) {
      addChartToDashboard(chart, dashboards[0]!.id);
      return;
    }
    const preferred =
      dashboards.find((d) => d.isDefault) ?? dashboards[0]!;
    setAddDashboardId(preferred.id);
    setAddTarget(chart);
  };

  /** Current draft: add the matching saved chart, or save first then add. */
  const addDraftToDashboard = () => {
    if (!config) return;
    if (matchingSaved) {
      requestAddToDashboard(matchingSaved);
      return;
    }
    setPendingAddAfterSave(true);
    setSaveName("");
    setSaveOpen(true);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const trades: BuilderTrade[] = data.data?.trades ?? [];
  const yDef = draft.y != null ? measureDef(draft.y) : null;
  const yFmt = yMeasureFormat(draft.y ?? undefined);
  const y2Fmt = yMeasureFormat(draft.y2 ?? undefined);
  const xFmt = yMeasureFormat(
    (NUMERIC_X_MEASURES as readonly string[]).includes(draft.x)
      ? (draft.x as YMeasure)
      : undefined
  );

  const formatKey = (key: string) =>
    formatCategoryKey(draft.x, key, locale, (k) => tBuckets(k as never));

  const warnings = React.useMemo(() => {
    const list = [...(result?.warnings ?? [])];
    if (data.data?.truncated) list.push("truncated");
    return list;
  }, [result, data.data]);

  return (
    <div className="space-y-6">
      {/* Header + sub-nav */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Tabs value="charts">
          <TabsList>
            <TabsTrigger value="overview" onClick={() => navigate("/analytics")}>
              {t("tabs.overview")}
            </TabsTrigger>
            <TabsTrigger value="charts">{t("tabs.charts")}</TabsTrigger>
            <TabsTrigger value="heatmaps" onClick={() => navigate("/analytics/heatmaps")}>
              {t("tabs.heatmaps")}
            </TabsTrigger>
          </TabsList>
          </Tabs>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("filters.period")}</Label>
            <Select
              value={draft.period}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, period: v as DraftConfig["period"] }))
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">{t("filters.period30d")}</SelectItem>
                <SelectItem value="90d">{t("filters.period90d")}</SelectItem>
                <SelectItem value="ytd">{t("filters.periodYtd")}</SelectItem>
                <SelectItem value="all">{t("filters.periodAll")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("filters.account")}</Label>
            <Select
              value={draft.accountId ?? "all"}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, accountId: v === "all" ? null : v }))
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allAccounts")}</SelectItem>
                {(accounts.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data.data?.accountMissing && (
            <p
              className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-muted-foreground"
              role="alert"
            >
              {t("filters.accountMissing")}
            </p>
          )}
          <p className="ml-auto text-xs text-muted-foreground">
            {data.isLoading
              ? t("filters.loading")
              : t("filters.tradeCount", { count: trades.length })}
          </p>
        </CardContent>
      </Card>

      {/* Builder */}
      <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
        {/* Config panel */}
        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">{t("config.title")}</CardTitle>
            <CardDescription>{t("config.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Presets */}
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("presets.title")}</Label>
              <div className="flex flex-wrap gap-1.5">
                <PresetButton
                  label={t("presets.rByHour")}
                  onClick={() =>
                    setDraft({
                      ...DEFAULT_DRAFT,
                      period: draft.period,
                      accountId: draft.accountId,
                      x: "hourOfDay",
                      y: "rMultiple",
                      aggregation: "avg",
                      chartType: "bar",
                    })
                  }
                />
                <PresetButton
                  label={t("presets.lotsByEmotion")}
                  onClick={() =>
                    setDraft({
                      ...DEFAULT_DRAFT,
                      period: draft.period,
                      accountId: draft.accountId,
                      x: "emotionBefore",
                      y: "lots",
                      aggregation: "sum",
                      chartType: "bar",
                    })
                  }
                />
                <PresetButton
                  label={t("presets.rVsHolding")}
                  onClick={() =>
                    setDraft({
                      ...DEFAULT_DRAFT,
                      period: draft.period,
                      accountId: draft.accountId,
                      x: "holdingTimeMin",
                      y: "rMultiple",
                      chartType: "scatter",
                      showTrendLine: true,
                    })
                  }
                />
                <PresetButton
                  label={t("presets.rDistribution")}
                  onClick={() =>
                    setDraft({
                      ...DEFAULT_DRAFT,
                      period: draft.period,
                      accountId: draft.accountId,
                      x: "rMultiple",
                      chartType: "histogram",
                    })
                  }
                />
              </div>
            </div>

            {/* Chart type */}
            <Field label={t("config.chartType")}>
              <Select value={draft.chartType} onValueChange={(v) => setChartType(v as ChartType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`config.chartType_${ct}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* X */}
            <Field label={t("config.xDimension")}>
              <Select value={draft.x} onValueChange={setX}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {draft.chartType === "scatter" || draft.chartType === "histogram"
                    ? (draft.chartType === "scatter"
                        ? ["tradeIndex", "date", ...NUMERIC_X_MEASURES]
                        : [...NUMERIC_X_MEASURES]
                      ).map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`dimensions.${x}` as never)}
                        </SelectItem>
                      ))
                    : X_DIMENSIONS.filter(
                        (x) => x !== "tradeIndex" || draft.chartType !== "box"
                      ).map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`dimensions.${x}` as never)}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Y (hidden for histogram) */}
            {draft.chartType !== "histogram" && (
              <Field label={t("config.yMeasure")}>
                <Select
                  value={draft.y ?? undefined}
                  onValueChange={setY}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("config.pickY")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Y_MEASURES.filter(
                      (m) =>
                        draft.chartType !== "box" ||
                        !AGGREGATE_MEASURES.includes(m)
                    ).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`measures.${m}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {/* Aggregation (per-trade measures on bar/line/area) */}
            {draft.chartType !== "histogram" &&
              draft.chartType !== "scatter" &&
              draft.chartType !== "box" &&
              draft.y != null &&
              !AGGREGATE_MEASURES.includes(draft.y) && (
                <Field label={t("config.aggregation")}>
                  <Select
                    value={draft.aggregation ?? "avg"}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, aggregation: v as Aggregation }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGREGATIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {t(`config.agg_${a}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

            {/* Percentile */}
            {draft.aggregation === "percentile" && (
              <Field label={t("config.percentile")}>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={draft.percentile}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      percentile: Math.min(
                        99,
                        Math.max(1, Number(e.target.value) || 50)
                      ),
                    }))
                  }
                />
              </Field>
            )}

            {/* Bin count (histogram) */}
            {draft.chartType === "histogram" && (
              <Field label={t("config.binCount")}>
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={draft.binCount ?? 20}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraft((d) => ({
                      ...d,
                      binCount: Number.isFinite(v) && v >= 5 && v <= 60 ? v : null,
                    }));
                  }}
                />
              </Field>
            )}

            {/* Group by */}
            {draft.chartType !== "histogram" && (
              <Field label={t("config.groupBy")}>
                <Select
                  value={draft.groupBy}
                  onValueChange={(v) => setDraft((d) => ({ ...d, groupBy: v as GroupBy }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_BYS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {t(`config.group_${g}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {/* Sort */}
            <Field label={t("config.sort")}>
              <Select
                value={draft.sort}
                onValueChange={(v) => setDraft((d) => ({ ...d, sort: v as ChartSort }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["natural", "valueDesc", "valueAsc", "keyAsc", "keyDesc"] as const).map(
                    (s) => (
                      <SelectItem key={s} value={s}>
                        {t(`config.sort_${s}` as never)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </Field>

            {/* Top N */}
            <Field label={t("config.topN")}>
              <Input
                type="number"
                min={3}
                max={50}
                placeholder={t("config.topNPlaceholder")}
                value={draft.topN ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    topN: v === "" ? null : Math.min(50, Math.max(3, Number(v) || 3)),
                  }));
                }}
              />
            </Field>

            {/* Min sample size */}
            <Field label={t("config.minSampleSize")}>
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.minSampleSize}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    minSampleSize: Math.min(
                      100,
                      Math.max(0, Number(e.target.value) || 0)
                    ),
                  }))
                }
              />
            </Field>

            {/* Trend line (scatter) */}
            {draft.chartType === "scatter" && (
              <div className="flex items-center justify-between">
                <Label htmlFor="trend-line">{t("config.trendLine")}</Label>
                <Switch
                  id="trend-line"
                  checked={draft.showTrendLine}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, showTrendLine: v }))}
                />
              </div>
            )}

            {/* Second axis (bar/line/area) */}
            {(draft.chartType === "bar" ||
              draft.chartType === "line" ||
              draft.chartType === "area") && (
              <Field label={t("config.secondAxis")}>
                <Select
                  value={draft.y2 ?? "none"}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, y2: v === "none" ? null : (v as YMeasure) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("config.none")}</SelectItem>
                    {Y_MEASURES.filter((m) => m !== draft.y).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`measures.${m}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                {t("preview.title")}
                {yDef ? ` - ${t(`measures.${draft.y}` as never)}` : ""}
              </CardTitle>
              <CardDescription>
                {draft.chartType === "scatter"
                  ? `${t(`dimensions.${draft.x}` as never)} → ${
                      draft.y ? t(`measures.${draft.y}` as never) : ""
                    }`
                  : `${t(`dimensions.${draft.x}` as never)}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTable((v) => !v)}
                      aria-pressed={showTable}
                    >
                      {showTable ? (
                        <ChartColumn aria-hidden="true" />
                      ) : (
                        <Table2 aria-hidden="true" />
                      )}
                      <span className="hidden sm:inline">
                        {showTable ? t("preview.viewAsChart") : t("preview.viewAsTable")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("preview.tableToggleHint")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={!result}
              >
                <Download aria-hidden="true" />
                <span className="hidden sm:inline">CSV</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportPng()}
                disabled={!result || showTable}
              >
                <ImageIcon aria-hidden="true" />
                <span className="hidden sm:inline">PNG</span>
              </Button>
              <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!config}>
                <Save aria-hidden="true" />
                <span className="hidden sm:inline">{t("saved.save")}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={addDraftToDashboard}
                disabled={!config}
                title={t("saved.addToDashboardHint")}
              >
                <LayoutDashboard aria-hidden="true" />
                <span className="hidden sm:inline">{t("saved.addToDashboard")}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-[340px] w-full" />
              </div>
            ) : trades.length === 0 ? (
              <EmptyState
                icon={<LineChartIcon aria-hidden="true" />}
                title={t("preview.empty")}
                description={t("preview.emptyDesc")}
                actionLabel={t("preview.emptyCta")}
                onAction={() => navigate("/trades/new")}
              />
            ) : !config ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="font-medium text-destructive">{t("preview.invalidConfig")}</p>
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-muted-foreground">
                  {errors.map((e) => (
                    <li key={e}>{t(`errors.${e}` as never)}</li>
                  ))}
                </ul>
              </div>
            ) : !result || (result.data.length === 0 && result.points.length === 0 && result.histogram.length === 0) ? (
              <EmptyState
                icon={<BarChart3 aria-hidden="true" />}
                title={t("preview.noData")}
                description={t("preview.noDataDesc")}
              />
            ) : showTable ? (
              <ChartTable
                result={result}
                formatKey={formatKey}
                yFormat={yFmt}
                y2Format={y2Fmt}
                currency={data.data?.currency ?? "USD"}
                t={(k) => tPreview(k as never)}
              />
            ) : (
              <>
                <div
                  ref={previewRef}
                  role="img"
                  aria-label={`${t("preview.title")} - ${t(`dimensions.${draft.x}` as never)}`}
                >
                  <ChartPreview
                    result={result}
                    config={config}
                    currency={data.data?.currency ?? "USD"}
                    xFormat={xFmt}
                    yFormat={yFmt}
                    y2Format={y2Fmt}
                    onDrill={onDrill}
                  />
                </div>
                {/* warnings + trend R² */}
                <div className="space-y-1 text-xs text-muted-foreground">
                  {result.trend && (
                    <p>
                      {t("preview.trendR2")}: {result.trend.r2.toFixed(3)} ·{" "}
                      {t("preview.trendSlope")}: {result.trend.slope.toFixed(4)}
                    </p>
                  )}
                  {result.excludedCount > 0 && (
                    <p>{t("preview.excluded", { count: result.excludedCount })}</p>
                  )}
                  {warnings.map((w) => (
                    <p key={w}>⚠ {t(`warnings.${w}` as never)}</p>
                  ))}
                  {result.chartType !== "histogram" && (
                    <p>{t("preview.drillHint")}</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Saved charts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("saved.title")}</CardTitle>
          <CardDescription>{t("saved.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {savedCharts.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : (savedCharts.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Save aria-hidden="true" />}
              title={t("saved.empty")}
              description={t("saved.emptyDesc")}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(savedCharts.data ?? []).map((sc) => {
                const cfg = parseSavedConfig(sc.config);
                return (
                  <div
                    key={sc.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border p-4"
                  >
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        <GitBranch aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                        {sc.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {cfg
                          ? `${t(`config.chartType_${cfg.chartType}`)} · ${t(
                              `dimensions.${cfg.x}` as never
                            )}${cfg.y ? ` · ${t(`measures.${cfg.y}` as never)}` : ""}`
                          : t("saved.brokenConfig")}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("saved.updated", {
                          date: new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                          }).format(new Date(sc.updatedAt)),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadSaved(sc)}
                        disabled={!cfg}
                      >
                        <TrendingUp aria-hidden="true" />
                        {t("saved.load")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => duplicateSaved(sc)}
                      >
                        <Copy aria-hidden="true" />
                        {t("saved.duplicate")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requestAddToDashboard(sc)}
                      >
                        <LayoutDashboard aria-hidden="true" />
                        {t("saved.addToDashboard")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeSaved(sc)}
                        aria-label={t("saved.delete")}
                      >
                        <Trash2 aria-hidden="true" className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save dialog */}
      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setPendingAddAfterSave(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("saved.saveTitle")}</DialogTitle>
            <DialogDescription>{t("saved.saveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chart-name">{t("saved.name")}</Label>
            <Input
              id="chart-name"
              value={saveName}
              placeholder={t("saved.namePlaceholder")}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doSave(saveName);
              }}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => void doSave(saveName)}
              disabled={saving || !saveName.trim() || !config}
            >
              {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
              {t("saved.saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dashboard picker (shown when several dashboards exist) */}
      <Dialog open={addTarget != null} onOpenChange={(open) => {
        if (!open) setAddTarget(null);
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("addToDashboard.title")}</DialogTitle>
            <DialogDescription>
              {addTarget
                ? t("addToDashboard.description", { name: addTarget.name })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="add-dashboard-select">
              {t("addToDashboard.dashboard")}
            </Label>
            <Select value={addDashboardId} onValueChange={setAddDashboardId}>
              <SelectTrigger id="add-dashboard-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dashboards.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.widgets.length >= MAX_WIDGETS_PER_DASHBOARD
                      ? ` (${t("addToDashboard.full")})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (addTarget && addDashboardId) {
                  addChartToDashboard(addTarget, addDashboardId);
                }
              }}
              disabled={!addTarget || !addDashboardId || addWidget.isPending}
            >
              {addWidget.isPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <LayoutDashboard aria-hidden="true" />
              )}
              {t("addToDashboard.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small local components ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={onClick}>
      {label}
    </Button>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onAction}>
          <Plus aria-hidden="true" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
