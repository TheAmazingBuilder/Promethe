"use client";

/**
 * v2.5 Module 2 — cross-heatmaps page (/analytics/heatmaps, spec §4.4).
 *
 * Preset dimension pairs (day × hour, session × instrument, strategy ×
 * emotion, weekday × session, instrument × strategy, regime × strategy) plus
 * any custom categorical pair from the builder dimensions. Metric selector,
 * configurable minimum sample size (default 5), natural/performance ordering,
 * totals, CSV/PNG export, "view as table" fallback, click-a-cell drill-down.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { BarChart3, Download, Image as ImageIcon, Table2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import { useBuilderData } from "@/hooks/use-charts";
import { useI18n } from "@/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { navigate } from "@/lib/router";
import { apiErrorMessage } from "@/lib/i18n-errors";
import {
  drillToTradeFilters,
  X_DIMENSION_DEFS,
  type BuilderTrade,
} from "@/lib/charts/builder";
import {
  buildMatrix,
  matrixToCsv,
  HEATMAP_METRICS,
  type HeatmapMetric,
  type HeatmapOrder,
  type MatrixResult,
} from "@/lib/charts/heatmap";
import {
  downloadTextFile,
  exportSvgToPng,
} from "@/lib/charts/export-png";
import type { XDimension } from "@/lib/validations/charts";
import { HeatmapMatrix } from "./heatmap-matrix";
import { formatCategoryKey, yMeasureFormat } from "./chart-preview";

/** Categorical dimensions usable on a heatmap axis. */
const HEATMAP_DIMS = X_DIMENSION_DEFS.filter(
  (d) => d.key !== "tradeIndex"
).map((d) => d.key) as XDimension[];

interface Preset {
  key: string;
  row: XDimension;
  col: XDimension;
}

const PRESETS: Preset[] = [
  { key: "dayHour", row: "dayOfWeek", col: "hourOfDay" },
  { key: "sessionInstrument", row: "session", col: "instrument" },
  { key: "strategyEmotion", row: "strategy", col: "emotionBefore" },
  { key: "weekdaySession", row: "dayOfWeek", col: "session" },
  { key: "instrumentStrategy", row: "instrument", col: "strategy" },
  { key: "regimeStrategy", row: "marketCondition", col: "strategy" },
];

const METRIC_FORMAT: Record<HeatmapMetric, ReturnType<typeof yMeasureFormat>> = {
  expectancyR: "R",
  netPnl: "CURRENCY",
  winRate: "PERCENT",
  profitFactor: "NUMBER",
  tradeCount: "NUMBER",
  avgR: "R",
};

export function HeatmapsView() {
  const t = useTranslations("chartsBuilder");
  const tHeat = useTranslations("chartsBuilder.heatmap");
  const tCommon = useTranslations("common");
  const { locale } = useI18n();
  const { toast } = useToast();

  const [rowDim, setRowDim] = React.useState<XDimension>("dayOfWeek");
  const [colDim, setColDim] = React.useState<XDimension>("hourOfDay");
  const [metric, setMetric] = React.useState<HeatmapMetric>("expectancyR");
  const [minSample, setMinSample] = React.useState(5);
  const [order, setOrder] = React.useState<HeatmapOrder>("natural");
  const [period, setPeriod] = React.useState<"30d" | "90d" | "ytd" | "all">("all");
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [showTable, setShowTable] = React.useState(false);
  const matrixRef = React.useRef<HTMLDivElement>(null);

  const accounts = useAccounts();
  const data = useBuilderData({ period, account: accountId });
  const trades: BuilderTrade[] = data.data?.trades ?? [];

  const result: MatrixResult | null = React.useMemo(() => {
    if (!data.data) return null;
    return buildMatrix(trades, rowDim, colDim, metric, {
      minSampleSize: minSample,
      order,
    });
  }, [data.data, trades, rowDim, colDim, metric, minSample, order]);

  const tBucket = useTranslations("chartsBuilder.buckets");
  const formatKey = React.useCallback(
    (dim: XDimension, key: string) =>
      formatCategoryKey(dim, key, locale, (k) => tBucket(k as never)),
    [locale, tBucket]
  );

  const applyPreset = (p: Preset) => {
    setRowDim(p.row);
    setColDim(p.col);
  };

  const onDrill = (drills: Array<{ dimension: XDimension; value: string }>) => {
    const parts: string[] = [];
    const unfilterable: string[] = [];
    for (const d of drills) {
      const filters = drillToTradeFilters(d.dimension, d.value);
      const keys = Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
      if (keys.length > 0) parts.push(...keys);
      else unfilterable.push(d.dimension);
    }
    if (unfilterable.length > 0) {
      toast({ description: t("preview.drillNotFilterable") });
    }
    navigate(parts.length > 0 ? `/trades?${parts.join("&")}` : "/trades");
  };

  const exportCsv = () => {
    if (!result) return;
    downloadTextFile(matrixToCsv(result), "heatmap.csv");
  };

  const exportPng = async () => {
    const ok = await exportSvgToPng(matrixRef.current, "heatmap.png");
    if (!ok) toast({ description: t("preview.exportFailed") });
  };

  const currency = data.data?.currency ?? "USD";

  return (
    <div className="space-y-6">
      {/* Header + sub-nav */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tHeat("title")}</h1>
          <p className="text-sm text-muted-foreground">{tHeat("description")}</p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label={t("tabs.charts")}>
          <Button variant="outline" size="sm" onClick={() => navigate("/analytics")}>
            {t("tabs.overview")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/analytics/charts")}>
            {t("tabs.charts")}
          </Button>
          <Button variant="secondary" size="sm" aria-current="page">
            {t("tabs.heatmaps")}
          </Button>
        </div>
      </div>

      {/* Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tHeat("configTitle")}</CardTitle>
          <CardDescription>{tHeat("configDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                variant={rowDim === p.row && colDim === p.col ? "default" : "secondary"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => applyPreset(p)}
              >
                {tHeat(`presets.${p.key}` as never)}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tHeat("rowDimension")}</Label>
              <Select value={rowDim} onValueChange={(v) => setRowDim(v as XDimension)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEATMAP_DIMS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`dimensions.${d}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tHeat("colDimension")}</Label>
              <Select value={colDim} onValueChange={(v) => setColDim(v as XDimension)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEATMAP_DIMS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`dimensions.${d}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tHeat("metric")}</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as HeatmapMetric)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEATMAP_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`measures.${m === "expectancyR" ? "expectancy" : m === "avgR" ? "rMultiple" : m}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tHeat("ordering")}</Label>
              <Select value={order} onValueChange={(v) => setOrder(v as HeatmapOrder)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">{tHeat("orderNatural")}</SelectItem>
                  <SelectItem value="performance">{tHeat("orderPerformance")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("filters.period")}</Label>
              <Select
                value={period}
                onValueChange={(v) => setPeriod(v as typeof period)}
              >
                <SelectTrigger>
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
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("filters.account")}</Label>
              <Select
                value={accountId ?? "all"}
                onValueChange={(v) => setAccountId(v === "all" ? null : v)}
              >
                <SelectTrigger>
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
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tHeat("minSample")}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={minSample}
                onChange={(e) =>
                  setMinSample(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                }
              />
            </div>
            <div className="flex items-end">
              <p className="text-xs text-muted-foreground">
                {data.isLoading
                  ? t("filters.loading")
                  : t("filters.tradeCount", { count: trades.length })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Matrix */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              {t(`dimensions.${rowDim}` as never)} × {t(`dimensions.${colDim}` as never)} -{" "}
              {t(`measures.${metric === "expectancyR" ? "expectancy" : metric === "avgR" ? "rMultiple" : metric}` as never)}
            </CardTitle>
            <CardDescription>{tHeat("matrixDesc", { minSample })}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
            >
              {showTable ? <BarChart3 aria-hidden="true" /> : <Table2 aria-hidden="true" />}
              <span className="hidden sm:inline">
                {showTable ? t("preview.viewAsChart") : t("preview.viewAsTable")}
              </span>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!result}>
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
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
              <BarChart3 aria-hidden="true" className="text-muted-foreground" />
              <p className="font-medium">{t("preview.empty")}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {t("preview.emptyDesc")}
              </p>
            </div>
          ) : !result || result.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
              <p className="font-medium">{t("preview.noData")}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {t("preview.noDataDesc")}
              </p>
            </div>
          ) : showTable ? (
            <HeatmapTable
              result={result}
              formatKey={formatKey}
              format={METRIC_FORMAT[metric]}
              currency={currency}
              locale={locale}
              tHeat={tHeat}
            />
          ) : (
            <>
              <div ref={matrixRef}>
                <HeatmapMatrix
                  result={result}
                  format={METRIC_FORMAT[metric]}
                  currency={currency}
                  locale={locale}
                  onDrill={onDrill}
                  tBucket={(k) => tBucket(k as never)}
                />
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {result.warnings.map((w) => (
                  <p key={w}>⚠ {t(`warnings.${w}` as never)}</p>
                ))}
                <p>{tHeat("keyboardHint")}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Table fallback ───────────────────────────────────────────────────────────

function HeatmapTable({
  result,
  formatKey,
  format,
  currency,
  locale,
  tHeat,
}: {
  result: MatrixResult;
  formatKey: (dim: XDimension, key: string) => string;
  format: ReturnType<typeof yMeasureFormat>;
  currency: string;
  locale: string;
  tHeat: (k: string) => string;
}) {
  const fmt = (v: number | null) => {
    if (v == null) return "-";
    switch (format) {
      case "CURRENCY":
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(v);
      case "PERCENT":
        return `${v.toFixed(1)} %`;
      case "R":
        return `${v.toFixed(2)} R`;
      default:
        return v.toFixed(2);
    }
  };
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{tHeat("rowColHeader")}</th>
            {result.colKeys.map((ck) => (
              <th key={ck} className="px-2 py-2 text-right font-medium">
                {formatKey(result.colDim, ck)}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">{tHeat("total")}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.key} className="border-t">
              <td className="px-3 py-1.5 font-medium">
                {formatKey(result.rowDim, row.key)}
              </td>
              {row.cells.map((c) => (
                <td
                  key={c.colKey}
                  className={`px-2 py-1.5 text-right font-mono ${
                    c.n === 0
                      ? "text-muted-foreground"
                      : (c.value ?? 0) >= 0
                        ? "text-gain"
                        : "text-loss"
                  }`}
                >
                  {c.n === 0 ? "-" : `${fmt(c.value)} (${c.n}${c.lowSample ? "⚠" : ""})`}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-mono">
                {fmt(row.total)} ({row.totalN})
              </td>
            </tr>
          ))}
          <tr className="border-t bg-muted/50">
            <td className="px-3 py-1.5 font-semibold">{tHeat("total")}</td>
            {result.colKeys.map((ck, i) => (
              <td key={ck} className="px-2 py-1.5 text-right font-mono">
                {fmt(result.colTotals[i])}
              </td>
            ))}
            <td className="px-3 py-1.5 text-right font-mono font-semibold">
              {fmt(result.grand.value)} ({result.grand.n})
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
