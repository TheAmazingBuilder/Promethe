"use client";

/**
 * v2.5 Module 2 — chart preview renderers (spec §4.1).
 *
 * Renders a ChartResult from the pure builder with Recharts (bar/line/area/
 * scatter/histogram) and a custom SVG box plot. All colors flow through the
 * semantic tokens (var(--chart-1..5), var(--gain), var(--loss)) so palettes
 * and dark mode apply automatically — never hard-code green/red (enforced by
 * tests/unit/no-hardcoded-pnl-colors.test.ts).
 *
 * Accessibility: every chart container has role="img" + aria-label; the parent
 * offers a "view as table" toggle; tooltips show sample sizes; low-sample
 * categories are greyed with a dashed stroke (redundant non-color cue).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { useTradingLabels } from "@/components/trades/trade-bits";
import { useI18n } from "@/i18n/i18n-provider";
import {
  MONTH_KEY_LIST,
  WEEKDAY_KEY_LIST,
  type ChartDatum,
  type ChartResult,
  type ScatterPoint,
} from "@/lib/charts/builder";
import type { ChartConfig, XDimension, YMeasure } from "@/lib/validations/charts";
import { fmtNum } from "@/lib/format";

// ── Colors (semantic tokens — never hard-coded) ──────────────────────────────

const SERIES_COLORS: Record<string, string> = {
  all: "var(--chart-1)",
  LONG: "var(--chart-1)",
  SHORT: "var(--chart-2)",
  WIN: "var(--gain)",
  LOSS: "var(--loss)",
  BREAKEVEN: "var(--neutral)",
  yes: "var(--gain)",
  no: "var(--loss)",
};

const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function seriesColor(key: string, index: number): string {
  return SERIES_COLORS[key] ?? CHART_VARS[index % CHART_VARS.length];
}

/** Measures whose sign carries meaning (bar coloring per sign). */
const SIGNED_MEASURES: readonly string[] = [
  "rMultiple",
  "netPnl",
  "pips",
  "points",
  "expectancy",
];

// ── Category key formatting ──────────────────────────────────────────────────

/** Localize a raw category key (weekday/month names via Intl, buckets via i18n). */
export function formatCategoryKey(
  dimension: XDimension | string,
  key: string,
  locale: string,
  tBucket: (k: string) => string
): string {
  switch (dimension) {
    case "dayOfWeek": {
      const idx = WEEKDAY_KEY_LIST.indexOf(key);
      if (idx >= 0) {
        return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
          new Date(2024, 0, 8 + idx) // 2024-01-08 = Monday
        );
      }
      return key;
    }
    case "month": {
      const idx = MONTH_KEY_LIST.indexOf(key);
      if (idx >= 0) {
        return new Intl.DateTimeFormat(locale, { month: "short" }).format(
          new Date(2024, idx, 1)
        );
      }
      return key;
    }
    case "hourOfDay":
      return `${key}h`;
    case "holdingTimeBucket":
      return safeT(tBucket, `hold_${key}`, key);
    case "lotSizeBucket":
      return safeT(tBucket, `lot_${key.replace(/\./g, "_")}`, key);
    case "riskPercentBucket":
      return safeT(tBucket, `risk_${key.replace(/\./g, "_")}`, key);
    case "week":
      return `W${key}`;
    default:
      return key;
  }
}

/** t() wrapper that falls back to the raw key when the message is missing. */
function safeT(t: (k: string) => string, key: string, fallback: string): string {
  try {
    const v = t(key);
    return v === key ? fallback : v;
  } catch {
    return fallback;
  }
}

// ── Value formatting (by measure format) ─────────────────────────────────────

export type MeasureFormatKind =
  | "R"
  | "CURRENCY"
  | "PIPS"
  | "POINTS"
  | "LOTS"
  | "PERCENT"
  | "NUMBER"
  | "DURATION";

export function formatMeasureValue(
  v: number | null | undefined,
  format: MeasureFormatKind,
  currency?: string
): string {
  if (v == null || !Number.isFinite(v)) return "-";
  switch (format) {
    case "CURRENCY":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency ?? "USD",
        maximumFractionDigits: 0,
      }).format(v);
    case "R":
      return `${fmtNum(v, 2)} R`;
    case "PIPS":
      return `${fmtNum(v, 1)} pips`;
    case "POINTS":
      return `${fmtNum(v, 1)} pts`;
    case "LOTS":
      return `${fmtNum(v, 2)} lots`;
    case "PERCENT":
      return `${fmtNum(v, 1)} %`;
    case "DURATION": {
      const min = Math.round(v);
      if (min < 60) return `${min} min`;
      if (min < 1440) return `${fmtNum(min / 60, 1)} h`;
      return `${fmtNum(min / 1440, 1)} d`;
    }
    default:
      return fmtNum(v, 2);
  }
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipEntry {
  name?: string;
  value?: number | string | null;
  color?: string;
  payload?: ChartDatum & Record<string, unknown>;
}

function ChartTooltip({
  active,
  entries,
  seriesDefs,
  format,
  currency,
  formatKey,
  t,
}: {
  active: boolean;
  entries: TooltipEntry[];
  seriesDefs: Array<{ key: string; label: string }>;
  format: MeasureFormatKind;
  currency: string;
  formatKey: (key: string) => string;
  t: (k: string) => string;
}) {
  if (!active || entries.length === 0) return null;
  const datum = entries[0]?.payload as (ChartDatum & Record<string, unknown>) | undefined;
  if (!datum) return null;
  return (
    <div className="min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{formatKey(datum.key)}</p>
      {entries.map((e) => (
        <p key={e.name ?? "?"} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: e.color }}
            />
            {seriesDefs.find((s) => s.key === e.name)?.label ?? e.name}
          </span>
          <span className="font-mono text-foreground">
            {formatMeasureValue(
              typeof e.value === "number" ? e.value : null,
              format,
              currency
            )}
          </span>
        </p>
      ))}
      <p className="mt-1 border-t pt-1 text-muted-foreground">
        {t("sampleSize")}: {datum.total}
        {datum.lowSample ? ` - ${t("lowSample")}` : ""}
      </p>
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
  formatX,
  formatY,
  t,
}: {
  active: boolean;
  payload?: Array<{ payload?: ScatterPoint }>;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  t: (k: string) => string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-mono">
        x: {formatX(p.x)} · y: {formatY(p.y)}
      </p>
      <button
        type="button"
        className="mt-1 text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => window.dispatchEvent(
          new CustomEvent("tj:chart-drill-trade", { detail: p.tradeId })
        )}
      >
        {t("openTrade")}
      </button>
    </div>
  );
}

// ── Main preview ─────────────────────────────────────────────────────────────

export interface ChartPreviewProps {
  result: ChartResult;
  config: ChartConfig;
  currency: string;
  xFormat: MeasureFormatKind;
  yFormat: MeasureFormatKind;
  y2Format: MeasureFormatKind;
  onDrill?: (drill: { dimension: XDimension; value: string }) => void;
  /** Chart body height in px - defaults to 340 (builder page size).
   *  Dashboard widgets pass their grid-derived height. */
  height?: number;
}

export function ChartPreview({
  result,
  config,
  currency,
  xFormat,
  yFormat,
  y2Format,
  onDrill,
  height = 340,
}: ChartPreviewProps) {
  const t = useTranslations("chartsBuilder.preview");
  const { locale } = useI18n();
  const tradingLabels = useTradingLabels();
  const tBucket = useTranslations("chartsBuilder.buckets");

  const formatKey = React.useCallback(
    (key: string) =>
      formatCategoryKey(config.x, key, locale, (k) => tBucket(k as never)),
    [config.x, locale, tBucket]
  );

  const labelOfDimensionValue = React.useCallback(
    (dim: string, value: string): string => {
      if (dim === "session") return tradingLabels.session(value);
      if (dim === "direction") return tradingLabels.direction(value);
      if (dim === "result") return tradingLabels.result(value);
      if (dim === "exitReason") return tradingLabels.exitReason(value);
      if (dim === "marketCondition") return tradingLabels.marketCondition(value);
      if (
        dim === "emotionBefore" ||
        dim === "emotionDuring" ||
        dim === "emotionAfter"
      ) {
        return tradingLabels.emotion(value);
      }
      if (dim === "followedPlan") {
        return value === "yes" ? t("yesLabel") : t("noLabel");
      }
      return formatKey(value);
    },
    [tradingLabels, formatKey, t]
  );

  const seriesDefs = result.series.map((s, i) => ({
    key: s.key,
    label:
      config.groupBy === "none"
        ? ""
        : labelOfDimensionValue(config.groupBy, s.key) || s.key,
    color: seriesColor(s.key, i),
  }));

  if (result.chartType === "scatter") {
    return (
      <ScatterPreview
        result={result}
        config={config}
        seriesDefs={seriesDefs}
        xFormat={xFormat}
        yFormat={yFormat}
        currency={currency}
        t={t}
        height={height}
      />
    );
  }
  if (result.chartType === "histogram") {
    return (
      <HistogramPreview
        result={result}
        xFormat={xFormat}
        t={t}
        height={height}
      />
    );
  }
  if (result.chartType === "box") {
    return (
      <BoxPlotPreview
        result={result}
        config={config}
        seriesDefs={seriesDefs}
        yFormat={yFormat}
        currency={currency}
        formatKey={formatKey}
        labelOf={labelOfDimensionValue}
        t={t}
        onDrill={onDrill}
        height={height}
      />
    );
  }
  return (
    <CategoricalPreview
      result={result}
      config={config}
      seriesDefs={seriesDefs}
      yFormat={yFormat}
      y2Format={y2Format}
      currency={currency}
      formatKey={formatKey}
      t={t}
      onDrill={onDrill}
      height={height}
    />
  );
}

// ── Bar / line / area (+ optional right axis) ────────────────────────────────

function CategoricalPreview({
  result,
  config,
  seriesDefs,
  yFormat,
  y2Format,
  currency,
  formatKey,
  t,
  onDrill,
  height,
}: {
  result: ChartResult;
  config: ChartConfig;
  seriesDefs: Array<{ key: string; label: string; color: string }>;
  yFormat: MeasureFormatKind;
  y2Format: MeasureFormatKind;
  currency: string;
  formatKey: (key: string) => string;
  t: (k: string) => string;
  onDrill?: (drill: { dimension: XDimension; value: string }) => void;
  height: number;
}) {
  const { reducedMotionActive } = useA11yPrefs();
  // Recharts data: flatten datum.values into { key, [seriesKey]: value }.
  const data = result.data.map((d) => ({
    key: formatKey(d.key),
    raw: d,
    total: d.total,
    lowSample: d.lowSample,
    ...d.values,
  }));
  const singleSeries = seriesDefs.length === 1 && seriesDefs[0].key === "all";
  const colorBySign =
    singleSeries && SIGNED_MEASURES.includes(config.y ?? "") && config.chartType === "bar";

  const handleBarClick = (entry: unknown) => {
    const raw = (entry as { raw?: ChartDatum } | undefined)?.raw;
    if (raw && onDrill) onDrill(raw.drill);
  };

  const xAxisTick = (v: string | number) => String(v);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
        <XAxis
          dataKey="key"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={12}
          tickFormatter={xAxisTick}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => formatMeasureValue(v, yFormat, currency)}
        />
        {config.y2 != null && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => formatMeasureValue(v, y2Format, currency)}
          />
        )}
        <Tooltip
          cursor={{ fillOpacity: 0.08 }}
          content={({ active, payload }) => (
            <ChartTooltip
              active={Boolean(active)}
              entries={(payload ?? []) as TooltipEntry[]}
              seriesDefs={seriesDefs}
              format={yFormat}
              currency={currency}
              formatKey={formatKey}
              t={t}
            />
          )}
        />
        <ReferenceLine yAxisId="left" y={0} stroke="var(--border)" />
        {config.chartType === "bar" &&
          seriesDefs.map((s) => (
            <Bar
              key={s.key}
              yAxisId="left"
              dataKey={s.key}
              name={s.key}
              fill={s.color}
              radius={[3, 3, 0, 0]}
              maxBarSize={42}
              onClick={handleBarClick}
              className={onDrill ? "cursor-pointer" : undefined}
              isAnimationActive={!reducedMotionActive}
            >
              {colorBySign &&
                data.map((d, i) => {
                  const v = d[s.key] as number | null;
                  return (
                    <Cell
                      key={i}
                      fill={v == null ? "var(--muted)" : v >= 0 ? "var(--gain)" : "var(--loss)"}
                      fillOpacity={d.raw.lowSample ? 0.35 : 1}
                      stroke={d.raw.lowSample ? "var(--muted-foreground)" : undefined}
                      strokeDasharray={d.raw.lowSample ? "3 2" : undefined}
                    />
                  );
                })}
              {!colorBySign &&
                data.map((d, i) => (
                  <Cell
                    key={i}
                    fillOpacity={d.raw.lowSample ? 0.35 : 1}
                    stroke={d.raw.lowSample ? "var(--muted-foreground)" : undefined}
                    strokeDasharray={d.raw.lowSample ? "3 2" : undefined}
                  />
                ))}
            </Bar>
          ))}
        {(config.chartType === "line" || config.chartType === "area") &&
          seriesDefs.map((s) =>
            config.chartType === "area" ? (
              <Area
                key={s.key}
                yAxisId="left"
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.15}
                dot={data.length <= 30 ? { r: 2.5 } : false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={!reducedMotionActive}
              />
            ) : (
              <Line
                key={s.key}
                yAxisId="left"
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={data.length <= 30 ? { r: 2.5 } : false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={!reducedMotionActive}
              />
            )
          )}
        {config.y2 != null && config.chartType === "line" && (
          <Line
            yAxisId="right"
            type="monotone"
            dataKey={config.y2}
            name={config.y2}
            stroke="var(--chart-3)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            connectNulls
            isAnimationActive={!reducedMotionActive}
          />
        )}
        {config.y2 != null && config.chartType === "bar" && (
          <Bar
            yAxisId="right"
            dataKey={config.y2}
            name={config.y2}
            fill="var(--chart-3)"
            fillOpacity={0.55}
            radius={[3, 3, 0, 0]}
            maxBarSize={42}
            isAnimationActive={!reducedMotionActive}
          />
        )}
        {config.y2 != null && config.chartType === "area" && (
          <Area
            yAxisId="right"
            type="monotone"
            dataKey={config.y2}
            name={config.y2}
            stroke="var(--chart-3)"
            strokeDasharray="5 3"
            strokeWidth={2}
            fill="var(--chart-3)"
            fillOpacity={0.08}
            dot={false}
            connectNulls
            isAnimationActive={!reducedMotionActive}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Scatter ──────────────────────────────────────────────────────────────────

function ScatterPreview({
  result,
  config,
  seriesDefs,
  xFormat,
  yFormat,
  currency,
  t,
  height,
}: {
  result: ChartResult;
  config: ChartConfig;
  seriesDefs: Array<{ key: string; label: string; color: string }>;
  xFormat: MeasureFormatKind;
  yFormat: MeasureFormatKind;
  currency: string;
  t: (k: string) => string;
  height: number;
}) {
  const { reducedMotionActive } = useA11yPrefs();
  const byGroup = new Map<string, ScatterPoint[]>();
  for (const p of result.points) {
    const list = byGroup.get(p.group);
    if (list) list.push(p);
    else byGroup.set(p.group, [p]);
  }
  const fmtX = (v: number) =>
    config.x === "date"
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(new Date(v))
      : formatMeasureValue(v, xFormat, currency);
  const fmtY = (v: number) => formatMeasureValue(v, yFormat, currency);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
        <XAxis
          type="number"
          dataKey="x"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmtX}
          domain={["auto", "auto"]}
        />
        <YAxis
          type="number"
          dataKey="y"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={fmtY}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", strokeOpacity: 0.4 }}
          content={({ active, payload }) => (
            <ScatterTooltip
              active={Boolean(active)}
              payload={payload as Array<{ payload?: ScatterPoint }> | undefined}
              formatX={fmtX}
              formatY={fmtY}
              t={t}
            />
          )}
        />
        {result.trend && (
          <ReferenceLine
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            segment={[
              { x: result.trend.from[0], y: result.trend.from[1] },
              { x: result.trend.to[0], y: result.trend.to[1] },
            ]}
          />
        )}
        {seriesDefs.map((s) => (
          <Scatter
            key={s.key}
            name={s.label || s.key}
            data={byGroup.get(s.key) ?? []}
            fill={s.color}
            fillOpacity={0.75}
            isAnimationActive={!reducedMotionActive}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Histogram ────────────────────────────────────────────────────────────────

function HistogramPreview({
  result,
  xFormat,
  t,
  height,
}: {
  result: ChartResult;
  xFormat: MeasureFormatKind;
  t: (k: string) => string;
  height: number;
}) {
  const { reducedMotionActive } = useA11yPrefs();
  const data = result.histogram.map((b, i) => ({
    key: `${fmtNum(b.from, 2)} → ${fmtNum(b.to, 2)}`,
    mid: (b.from + b.to) / 2,
    count: b.count,
    bin: b,
    i,
  }));
  const total = result.histogram.reduce((a, b) => a + b.count, 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
        <XAxis
          dataKey="mid"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={(v: number) => fmtNum(v, 2)}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fillOpacity: 0.08 }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]?.payload) return null;
            const bin = (payload[0].payload as { bin?: { from: number; to: number; count: number } }).bin;
            if (!bin) return null;
            const pct = total > 0 ? (bin.count / total) * 100 : 0;
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="font-mono">
                  {fmtNum(bin.from, 2)} → {fmtNum(bin.to, 2)}
                </p>
                <p className="text-muted-foreground">
                  {bin.count} ({fmtNum(pct, 1)} %) - {formatMeasureValue(bin.from, xFormat)}
                </p>
                <p className="text-muted-foreground">{t("tradesInBin")}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="count" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={!reducedMotionActive} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Box plot (custom SVG) ────────────────────────────────────────────────────

function BoxPlotPreview({
  result,
  config,
  seriesDefs,
  yFormat,
  currency,
  formatKey,
  labelOf,
  t,
  onDrill,
  height: bodyHeight,
}: {
  result: ChartResult;
  config: ChartConfig;
  seriesDefs: Array<{ key: string; label: string; color: string }>;
  yFormat: MeasureFormatKind;
  currency: string;
  formatKey: (key: string) => string;
  labelOf: (dim: string, value: string) => string;
  t: (k: string) => string;
  onDrill?: (drill: { dimension: XDimension; value: string }) => void;
  height: number;
}) {
  const width = 900;
  const height = Math.max(220, bodyHeight);
  const padL = 64;
  const padR = 16;
  const padT = 16;
  const padB = 56;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Y scale over all box values + outliers.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const d of result.data) {
    for (const box of Object.values(d.boxes ?? {})) {
      if (!box) continue;
      const vals = [box.whiskerLow, box.whiskerHigh, ...box.outliers];
      yMin = Math.min(yMin, ...vals);
      yMax = Math.max(yMax, ...vals);
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.06;
  yMin -= pad;
  yMax += pad;
  const yOf = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const slotW = plotW / Math.max(1, result.data.length);
  const boxW = Math.min(28, (slotW * 0.62) / Math.max(1, seriesDefs.length));
  const yTicks = 5;
  const ticks = Array.from({ length: yTicks }, (_, i) => yMin + ((yMax - yMin) * i) / (yTicks - 1));

  const [hover, setHover] = React.useState<string | null>(null);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={t("boxAria")}
    >
      {/* gridlines + y axis */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={width - padR}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <text
            x={padL - 8}
            y={yOf(v) + 3}
            textAnchor="end"
            fontSize={11}
            fill="var(--muted-foreground)"
          >
            {formatMeasureValue(v, yFormat, currency)}
          </text>
        </g>
      ))}
      <line
        x1={padL}
        x2={width - padR}
        y1={yOf(Math.max(yMin, Math.min(0, yMax)))}
        y2={yOf(Math.max(yMin, Math.min(0, yMax)))}
        stroke="var(--border)"
      />

      {/* boxes */}
      {result.data.map((d, di) => {
        const cx0 = padL + di * slotW;
        const isHover = hover === `${d.key}`;
        return (
          <g key={d.key}>
            {seriesDefs.map((s, si) => {
              const box = d.boxes?.[s.key];
              if (!box) return null;
              const cx = cx0 + slotW / 2 + (si - (seriesDefs.length - 1) / 2) * (boxW + 4);
              const lowY = yOf(box.whiskerHigh);
              const highY = yOf(box.whiskerLow);
              const q1Y = yOf(box.q3);
              const q3Y = yOf(box.q1);
              const medY = yOf(box.median);
              const color = s.color;
              const dim = d.lowSample ? 0.4 : 1;
              return (
                <g
                  key={s.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${formatKey(d.key)}: Q1 ${fmtNum(box.q1, 2)}, med ${fmtNum(box.median, 2)}, Q3 ${fmtNum(box.q3, 2)}`}
                  className="outline-none focus-visible:outline-2 focus-visible:outline-ring"
                  onMouseEnter={() => setHover(d.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onDrill?.(d.drill)}
                  style={{ cursor: onDrill ? "pointer" : undefined }}
                >
                  {/* whisker */}
                  <line x1={cx} x2={cx} y1={lowY} y2={q1Y} stroke={color} strokeWidth={1.5} opacity={dim} />
                  <line x1={cx} x2={cx} y1={q3Y} y2={highY} stroke={color} strokeWidth={1.5} opacity={dim} />
                  <line x1={cx - boxW / 3} x2={cx + boxW / 3} y1={lowY} y2={lowY} stroke={color} strokeWidth={1.5} opacity={dim} />
                  <line x1={cx - boxW / 3} x2={cx + boxW / 3} y1={highY} y2={highY} stroke={color} strokeWidth={1.5} opacity={dim} />
                  {/* box */}
                  <rect
                    x={cx - boxW / 2}
                    y={q1Y}
                    width={boxW}
                    height={Math.max(1, q3Y - q1Y)}
                    fill={color}
                    fillOpacity={0.18 * dim}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray={d.lowSample ? "3 2" : undefined}
                    opacity={dim}
                    rx={2}
                  />
                  {/* median */}
                  <line
                    x1={cx - boxW / 2}
                    x2={cx + boxW / 2}
                    y1={medY}
                    y2={medY}
                    stroke={color}
                    strokeWidth={2.5}
                    opacity={dim}
                  />
                  {/* outliers */}
                  {box.outliers.map((o, oi) => (
                    <circle
                      key={oi}
                      cx={cx}
                      cy={yOf(o)}
                      r={2}
                      fill="var(--muted-foreground)"
                      opacity={dim}
                    />
                  ))}
                  {isHover && (
                    <text
                      x={cx}
                      y={padT - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--foreground)"
                    >
                      n={d.total}
                    </text>
                  )}
                </g>
              );
            })}
            {/* x label (skip when crowded) */}
            {(result.data.length <= 24 || di % Math.ceil(result.data.length / 24) === 0) && (
              <text
                x={cx0 + slotW / 2}
                y={height - padB + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {formatKey(d.key).slice(0, 10)}
              </text>
            )}
          </g>
        );
      })}
      {/* legend */}
      {seriesDefs.length > 1 && (
        <g>
          {seriesDefs.map((s, i) => (
            <g key={s.key} transform={`translate(${padL + i * 120}, ${height - 12})`}>
              <rect width={10} height={10} y={-9} fill={s.color} fillOpacity={0.4} stroke={s.color} rx={2} />
              <text x={16} fontSize={11} fill="var(--muted-foreground)">
                {labelOf(config.groupBy, s.key) || s.key}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ── Table fallback (accessibility) ───────────────────────────────────────────

export function ChartTable({
  result,
  formatKey,
  yFormat,
  y2Format,
  currency,
  t,
}: {
  result: ChartResult;
  formatKey: (key: string) => string;
  yFormat: MeasureFormatKind;
  y2Format: MeasureFormatKind;
  currency: string;
  t: (k: string) => string;
}) {
  if (result.chartType === "scatter") {
    return (
      <div className="max-h-96 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">x</th>
              <th className="px-3 py-2 text-left font-medium">y</th>
              <th className="px-3 py-2 text-left font-medium">{t("sampleSize")}</th>
            </tr>
          </thead>
          <tbody>
            {result.points.slice(0, 400).map((p, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5 font-mono">{fmtNum(p.x, 2)}</td>
                <td className="px-3 py-1.5 font-mono">{fmtNum(p.y, 2)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{p.group}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (result.chartType === "histogram") {
    return (
      <div className="max-h-96 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("binFrom")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("binTo")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("count")}</th>
            </tr>
          </thead>
          <tbody>
            {result.histogram.map((b, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5 font-mono">{fmtNum(b.from, 2)}</td>
                <td className="px-3 py-1.5 font-mono">{fmtNum(b.to, 2)}</td>
                <td className="px-3 py-1.5 font-mono">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const seriesKeys = result.series.map((s) => s.key);
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t("category")}</th>
            {seriesKeys.map((k) => (
              <th key={k} className="px-3 py-2 text-right font-medium">
                {k === "all" ? "" : k}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">{t("sampleSize")}</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((d) => (
            <tr key={d.key} className="border-t">
              <td className="px-3 py-1.5">{formatKey(d.key)}</td>
              {seriesKeys.map((k) => (
                <td
                  key={k}
                  className={`px-3 py-1.5 text-right font-mono ${
                    (d.values[k] ?? 0) >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {formatMeasureValue(d.values[k], yFormat, currency)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right text-muted-foreground">
                {d.total}
                {d.lowSample ? " ⚠" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Y2 measure format resolution helper for the parent. */
export function yMeasureFormat(m: YMeasure | undefined): MeasureFormatKind {
  switch (m) {
    case "netPnl":
      return "CURRENCY";
    case "pips":
      return "PIPS";
    case "points":
      return "POINTS";
    case "lots":
      return "LOTS";
    case "riskPercent":
    case "winRate":
      return "PERCENT";
    case "rMultiple":
    case "expectancy":
    case "mfeR":
    case "maeR":
      return "R";
    case "avgHoldingTime":
      return "DURATION";
    default:
      return "NUMBER";
  }
}
