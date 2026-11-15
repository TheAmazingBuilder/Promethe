"use client";

/**
 * session / weekday / hour performance widgets — BarChart of net P&L per
 * group, cells colored by sign (semantic gain / loss tokens).
 */
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
import { useTradingLabels } from "@/components/trades/trade-bits";
import { fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { asGroupsData } from "./types";

interface PerfDatum {
  key: string;
  label: string;
  netPnl: number;
}

function PerfTooltipContent({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: PerfDatum }>;
  currency: string;
}) {
  const fmt = useFormat();
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{point.label}</p>
      <p className="mt-1 tabular-nums">
        {fmt.signedMoney(point.netPnl, currency)}
      </p>
    </div>
  );
}

export function PerformanceChartWidget({
  data,
  currency,
  heightPx,
  dimension,
  locale,
}: {
  data: unknown;
  currency: string;
  heightPx: number;
  dimension: "session" | "weekday" | "hour";
  locale: string;
}) {
  const t = useTranslations("analytics");
  const labels = useTradingLabels();
  const fmt = useFormat();
  const { reducedMotionActive } = useA11yPrefs();
  // §3.1: the Y axis is a currency scale (net P&L) — it must not draw real
  // amounts in HIDE mode (BLUR cannot blur SVG text — documented limit).
  const amountsHidden =
    fmt.privacyMode === "HIDE" && fmt.isMasked("amount");

  const labelOf = React.useCallback(
    (key: string): string => {
      if (dimension === "session") return labels.session(key);
      if (dimension === "weekday") {
        const n = Number(key);
        if (!Number.isFinite(n)) return key;
        try {
          // ISO weekday 1-7 → localized name via a stable reference week
          // (2024-01-01 was a Monday).
          return new Intl.DateTimeFormat(locale, {
            weekday: "short",
            timeZone: "UTC",
          }).format(new Date(Date.UTC(2024, 0, n)));
        } catch {
          return key;
        }
      }
      const h = Number(key);
      if (!Number.isFinite(h)) return key;
      const two = (n: number) => String(n).padStart(2, "0");
      return `${two(h)}–${two(h + 2)}h`;
    },
    [dimension, labels, locale]
  );

  const rows = React.useMemo<PerfDatum[]>(() => {
    const groups = asGroupsData(data)?.groups ?? [];
    const sorted =
      dimension === "weekday"
        ? [...groups].sort((a, b) => Number(a.key) - Number(b.key))
        : dimension === "hour"
          ? [...groups].sort((a, b) => Number(a.key) - Number(b.key))
          : groups;
    return sorted.map((g) => ({
      key: g.key,
      label: labelOf(g.key),
      netPnl: Number(g.stats.netPnl),
    }));
  }, [data, dimension, labelOf]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("insights.insightsEmpty")}</p>;
  }

  return (
    <div className="w-full" style={{ height: heightPx }} role="img" aria-label={t("rdistDesc")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={dimension === "hour" ? -30 : 0}
            textAnchor={dimension === "hour" ? "end" : "middle"}
            height={dimension === "hour" ? 44 : 24}
          />
          <YAxis
            tickFormatter={(value: number) =>
              amountsHidden ? fmt.money(value, currency, 0) : fmtNum(value, 0)
            }
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ fillOpacity: 0.15 }}
            content={<PerfTooltipContent currency={currency} />}
          />
          <Bar dataKey="netPnl" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={!reducedMotionActive}>
            {rows.map((row) => (
              <Cell
                key={row.key}
                fill={row.netPnl >= 0 ? "var(--gain)" : "var(--loss)"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
