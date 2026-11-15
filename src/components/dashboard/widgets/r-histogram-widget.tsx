"use client";

/** r-histogram widget — trade count per R bucket (labels reused from analytics). */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { fmtNum } from "@/lib/format";
import { asRHistogramData } from "./types";

interface RHistogramDatum {
  id: string;
  label: string;
  count: number;
  negative: boolean;
}

function RTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RHistogramDatum }>;
}) {
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{point.label}</p>
      <p className="mt-1 tabular-nums">{point.count}</p>
    </div>
  );
}

export function RHistogramWidget({
  data,
  heightPx,
}: {
  data: unknown;
  heightPx: number;
}) {
  const t = useTranslations("analytics");
  const { reducedMotionActive } = useA11yPrefs();

  const rows = React.useMemo<RHistogramDatum[]>(() => {
    const buckets = asRHistogramData(data)?.buckets.buckets ?? [];
    return buckets.map((b) => ({
      id: b.id,
      label: t(`rdist.${b.id}`),
      count: b.count,
      negative: b.to != null ? b.to <= 0 : false,
    }));
  }, [data, t]);

  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t("insights.insightsEmpty")}</p>;
  }

  return (
    <div className="w-full" style={{ height: heightPx }} role="img" aria-label={t("rdistTitle")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip cursor={{ fillOpacity: 0.15 }} content={<RTooltipContent />} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={!reducedMotionActive}>
            {rows.map((row) => (
              <Cell
                key={row.id}
                fill={row.negative ? "var(--loss)" : "var(--gain)"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function rHistogramTotal(data: unknown): number {
  const buckets = asRHistogramData(data)?.buckets.buckets ?? [];
  return buckets.reduce((acc, b) => acc + b.count, 0);
}

export function rHistogramWithoutR(data: unknown): number {
  return asRHistogramData(data)?.buckets.withoutR ?? 0;
}

export function fmtHistogramCount(n: number): string {
  return fmtNum(n, 0);
}
