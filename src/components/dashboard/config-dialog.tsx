"use client";

/**
 * Generic widget config dialog — renders type-specific fields from the
 * registry schemas (kpi list w/ reorder + max 8, limits, sticky-note
 * markdown, custom metric picker, comparison metric). Saving validates
 * through safeParseWidgetConfig before PATCHing.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, PencilRuler } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCustomMetrics } from "@/hooks/use-dashboards";
import { useSavedCharts } from "@/hooks/use-charts";
import { navigate } from "@/lib/router";
import { safeParseWidgetConfig } from "@/lib/dashboard/registry";
import {
  HEATMAP_DIM_KEYS,
  heatmapWidgetConfigSchema,
  savedChartWidgetConfigSchema,
} from "@/lib/dashboard/register-chart-widgets";
import { HEATMAP_METRICS, type HeatmapMetric } from "@/lib/charts/heatmap";
import type { XDimension } from "@/lib/validations/charts";
import {
  KPI_KEYS,
  KPI_STRIP_MAX,
  type DashboardWidgetDTO,
  type KpiKey,
} from "@/lib/dashboard/types";

/** Widget types whose config schema is empty - the dialog shows a note. */
const NO_SETTINGS_TYPES = new Set([
  "equity-curve",
  "drawdown-curve",
  "open-trades",
  "session-performance",
  "weekday-performance",
  "hour-performance",
  "r-histogram",
  "win-loss",
  "streak",
  "goals-progress",
  "journal-prompt",
  "review-queue",
  "prop-status",
  "sync-status",
  "quick-actions",
  "year-calendar",
]);

function asRecord(config: unknown): Record<string, unknown> {
  return typeof config === "object" && config !== null
    ? (config as Record<string, unknown>)
    : {};
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function WidgetConfigDialog({
  widget,
  open,
  onOpenChange,
  onSave,
}: {
  widget: DashboardWidgetDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the schema-validated config ready to PATCH. */
  onSave: (config: unknown) => void;
}) {
  const t = useTranslations("dashboards");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: metrics } = useCustomMetrics();
  const initial = asRecord(widget.config);

  // ── Draft state (the dialog is remounted with a key on every open) ──
  const [kpis, setKpis] = React.useState<KpiKey[]>(() => {
    const raw = Array.isArray(initial.kpis)
      ? ((initial.kpis.filter((k): k is KpiKey => typeof k === "string") as KpiKey[])
          .filter((k) => (KPI_KEYS as readonly string[]).includes(k)))
      : [];
    return raw.length > 0
      ? raw
      : ["netPnl", "winRate", "profitFactor", "expectancyR"];
  });
  const [showDelta, setShowDelta] = React.useState(initial.showDelta === true);
  const [showSparkline, setShowSparkline] = React.useState(
    initial.showSparkline === true
  );
  const [singleKpi, setSingleKpi] = React.useState<KpiKey>(
    typeof initial.kpi === "string" &&
      (KPI_KEYS as readonly string[]).includes(initial.kpi)
      ? (initial.kpi as KpiKey)
      : "netPnl"
  );
  const [months, setMonths] = React.useState<number>(num(initial.months, 1));
  const [limit, setLimit] = React.useState<number>(num(initial.limit, 6));
  const [markdown, setMarkdown] = React.useState(
    typeof initial.markdown === "string" ? initial.markdown : ""
  );
  const [metricId, setMetricId] = React.useState(
    typeof initial.metricId === "string" ? initial.metricId : ""
  );
  const [compareMetric, setCompareMetric] = React.useState<string>(
    typeof initial.metric === "string" ? initial.metric : "netPnl"
  );
  // ── v2.5 M2 chart widgets ──
  const { data: savedCharts } = useSavedCharts();
  const [chartId, setChartId] = React.useState(
    typeof initial.chartId === "string" ? initial.chartId : ""
  );
  const defaultHeatmap = heatmapWidgetConfigSchema.parse({});
  const [hmRow, setHmRow] = React.useState<XDimension>(
    typeof initial.rowDim === "string" && HEATMAP_DIM_KEYS.includes(initial.rowDim as XDimension)
      ? (initial.rowDim as XDimension)
      : defaultHeatmap.rowDim
  );
  const [hmCol, setHmCol] = React.useState<XDimension>(
    typeof initial.colDim === "string" && HEATMAP_DIM_KEYS.includes(initial.colDim as XDimension)
      ? (initial.colDim as XDimension)
      : defaultHeatmap.colDim
  );
  const [hmMetric, setHmMetric] = React.useState<HeatmapMetric>(
    typeof initial.metric === "string" && (HEATMAP_METRICS as readonly string[]).includes(initial.metric)
      ? (initial.metric as HeatmapMetric)
      : defaultHeatmap.metric
  );
  const [hmMinSample, setHmMinSample] = React.useState(
    num(initial.minSampleSize, defaultHeatmap.minSampleSize)
  );

  const hasSettings = !NO_SETTINGS_TYPES.has(widget.type);

  const toggleKpi = (key: KpiKey, checked: boolean) => {
    if (checked) {
      if (kpis.length >= KPI_STRIP_MAX) return;
      setKpis((prev) => [...prev, key]);
    } else {
      setKpis((prev) => prev.filter((k) => k !== key));
    }
  };

  const moveKpi = (index: number, delta: -1 | 1) => {
    setKpis((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const buildConfig = (): unknown => {
    switch (widget.type) {
      case "kpi-strip":
        return { kpis, showDelta, showSparkline };
      case "single-kpi":
        return { kpi: singleKpi, showDelta };
      case "pnl-calendar":
        return { months };
      case "recent-trades":
      case "strategy-table":
      case "instrument-table":
      case "next-news":
        return { limit };
      case "sticky-note":
        return { markdown };
      case "custom-metric":
        return { metricId };
      case "period-compare":
        return { metric: compareMetric };
      case "saved-chart":
        return savedChartWidgetConfigSchema.parse({
          chartId: chartId || savedCharts?.[0]?.id || "",
        });
      case "heatmap":
        return heatmapWidgetConfigSchema.parse({
          rowDim: hmRow,
          colDim: hmCol,
          metric: hmMetric,
          minSampleSize: hmMinSample,
        });
      default:
        return {};
    }
  };

  const save = () => {
    const draft = buildConfig();
    const parsed = safeParseWidgetConfig(widget.type, draft);
    if (!parsed.ok) {
      toast({ title: t("config.invalid"), variant: "destructive" });
      return;
    }
    onSave(parsed.config);
    onOpenChange(false);
  };

  const renderFields = () => {
    switch (widget.type) {
      case "kpi-strip":
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("config.kpisHelp", { max: KPI_STRIP_MAX })}
            </p>
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {kpis.map((key, index) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                >
                  <Checkbox
                    checked
                    onCheckedChange={(checked) =>
                      toggleKpi(key, checked === true)
                    }
                    aria-label={t(`kpi.${key}`)}
                  />
                  <span className="flex-1 text-sm">{t(`kpi.${key}`)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveKpi(index, -1)}
                    disabled={index === 0}
                    aria-label={t("config.moveUp", { name: t(`kpi.${key}`) })}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveKpi(index, 1)}
                    disabled={index === kpis.length - 1}
                    aria-label={t("config.moveDown", { name: t(`kpi.${key}`) })}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 rounded-md border p-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("config.availableKpis")}
              </p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {KPI_KEYS.filter((k) => !kpis.includes(k)).map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={kpis.length >= KPI_STRIP_MAX}
                    onClick={() => toggleKpi(key, true)}
                  >
                    + {t(`kpi.${key}`)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="h-px w-full bg-border" aria-hidden="true" />
            <ConfigSwitch
              id="kpi-show-delta"
              label={t("config.showDelta")}
              checked={showDelta}
              onCheckedChange={setShowDelta}
            />
            <ConfigSwitch
              id="kpi-show-sparkline"
              label={t("config.showSparkline")}
              checked={showSparkline}
              onCheckedChange={setShowSparkline}
            />
          </div>
        );

      case "single-kpi":
        return (
          <div className="space-y-3">
            <ConfigSelect
              id="single-kpi-select"
              label={t("config.kpi")}
              value={singleKpi}
              onValueChange={(v) => setSingleKpi(v as KpiKey)}
              options={KPI_KEYS.map((k) => ({
                value: k,
                label: t(`kpi.${k}`),
              }))}
            />
            <ConfigSwitch
              id="single-kpi-delta"
              label={t("config.showDelta")}
              checked={showDelta}
              onCheckedChange={setShowDelta}
            />
          </div>
        );

      case "pnl-calendar":
        return (
          <ConfigSelect
            id="cal-months"
            label={t("config.months")}
            value={String(months)}
            onValueChange={(v) => setMonths(Number(v))}
            options={[1, 2, 3].map((m) => ({
              value: String(m),
              label: t("config.monthsValue", { count: m }),
            }))}
          />
        );

      case "recent-trades":
      case "strategy-table":
      case "instrument-table":
      case "next-news": {
        const max = widget.type === "next-news" ? 10 : 12;
        const values = Array.from({ length: max - 2 }, (_, i) => i + 3);
        return (
          <ConfigSelect
            id="table-limit"
            label={t("config.limit")}
            value={String(limit)}
            onValueChange={(v) => setLimit(Number(v))}
            options={values.map((n) => ({
              value: String(n),
              label: t("config.rows", { count: n }),
            }))}
          />
        );
      }

      case "sticky-note":
        return (
          <div className="space-y-1.5">
            <Label htmlFor="sticky-markdown">{t("config.markdown")}</Label>
            <Textarea
              id="sticky-markdown"
              value={markdown}
              maxLength={4000}
              rows={8}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={t("config.markdownPlaceholder")}
            />
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {markdown.length}/4000
            </p>
          </div>
        );

      case "custom-metric":
        return metrics == null || metrics.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("config.metricEmpty")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                navigate("#/reglages/dashboards");
              }}
            >
              {t("config.metricGoSettings")}
            </Button>
          </div>
        ) : (
          <ConfigSelect
            id="custom-metric-select"
            label={t("config.metric")}
            value={metricId || metrics[0]!.id}
            onValueChange={setMetricId}
            options={metrics.map((m) => ({ value: m.id, label: m.name }))}
          />
        );

      case "period-compare":
        return (
          <ConfigSelect
            id="compare-metric"
            label={t("config.metric")}
            value={compareMetric}
            onValueChange={setCompareMetric}
            options={(
              ["netPnl", "winRate", "tradeCount", "profitFactor"] as const
            ).map((m) => ({ value: m, label: t(`kpi.${m}`) }))}
          />
        );

      case "saved-chart":
        return savedCharts == null || savedCharts.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("config.chartEmpty")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                navigate("#/analytics/charts");
              }}
            >
              {t("config.chartGoBuilder")}
            </Button>
          </div>
        ) : (
          <ConfigSelect
            id="saved-chart-select"
            label={t("config.chart")}
            value={chartId || savedCharts[0]!.id}
            onValueChange={setChartId}
            options={savedCharts.map((c) => ({ value: c.id, label: c.name }))}
          />
        );

      case "heatmap": {
        const dimOptions = HEATMAP_DIM_KEYS.map((d) => ({
          value: d,
          label: tRoot(`chartsBuilder.dimensions.${d}` as never),
        }));
        return (
          <div className="space-y-3">
            <ConfigSelect
              id="heatmap-row"
              label={t("config.rowDimension")}
              value={hmRow}
              onValueChange={(v) => setHmRow(v as XDimension)}
              options={dimOptions}
            />
            <ConfigSelect
              id="heatmap-col"
              label={t("config.colDimension")}
              value={hmCol}
              onValueChange={(v) => setHmCol(v as XDimension)}
              options={dimOptions}
            />
            <ConfigSelect
              id="heatmap-metric"
              label={t("config.metric")}
              value={hmMetric}
              onValueChange={(v) => setHmMetric(v as HeatmapMetric)}
              options={HEATMAP_METRICS.map((m) => ({
                value: m,
                label: tRoot(
                  `chartsBuilder.measures.${
                    m === "expectancyR" ? "expectancy" : m === "avgR" ? "rMultiple" : m
                  }` as never
                ),
              }))}
            />
            <ConfigSelect
              id="heatmap-min-sample"
              label={t("config.minSample")}
              value={String(hmMinSample)}
              onValueChange={(v) => setHmMinSample(Number(v))}
              options={[0, 3, 5, 10, 20].map((n) => ({
                value: String(n),
                label: t("config.minSampleValue", { count: n }),
              }))}
            />
            <p className="text-xs text-muted-foreground">
              {t("config.minSampleHint")}
            </p>
          </div>
        );
      }

      default:
        return (
          <p className="text-sm text-muted-foreground">
            {t("config.noSettings")}
          </p>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilRuler className="h-4 w-4" aria-hidden="true" />
            {t("config.title")}
          </DialogTitle>
          <DialogDescription>{t("config.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">{renderFields()}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("edit.cancel")}
          </Button>
          <Button onClick={save} disabled={!hasSettings}>
            {t("config.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small internal helpers keep the switch above readable. */
function ConfigSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ConfigSelect({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
