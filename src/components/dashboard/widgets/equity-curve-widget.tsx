"use client";

/**
 * equity-curve / drawdown-curve widgets — the AreaChart ported from the old
 * dashboard view (colors follow the semantic gain/loss tokens, v2.5 M1).
 *
 * v2.5 Module 8 Phase 2 — privacy (§3.1): when currency amounts are masked in
 * HIDE mode, the EQUITY curve switches its Y metric from currency to PERCENT
 * (cumPnl / initialBalance × 100 — same normalization as the share-link
 * redaction), so no currency value reaches the chart SVG. If the initial
 * balance is missing or ≤ 0, the currency series is kept but the tick
 * formatter masks. Tooltips and the drawdown curve go through useFormat()
 * (placeholder in HIDE mode).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { fmtDateInTz, fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { toD } from "@/lib/trading/dec";
import { asCurveData, type CurveWidgetData } from "./types";

/** Curve point, numeric form for recharts. */
interface CurveDatum {
  date: string;
  equity: number;
  cumPnl: number;
  drawdown: number;
  /** Plotted Y value: equity/drawdown (currency) or cumPnl in % of initial. */
  value: number;
}

const ROSE = "text-loss";

/** Signed percentage label for the PERCENT axis/tooltip ("+12,4 %"). */
function usePctLabel() {
  const fmt = useFormat();
  return React.useCallback(
    (v: number): string =>
      // Percentages themselves may be masked (hidePercentages) — then fmt.pct
      // returns the placeholder instead of the signed label.
      fmt.isMasked("percent") ? fmt.pct(v, 1) : `${fmt.signed(v, 1, 1)} %`,
    [fmt]
  );
}

/** Recharts tooltip: date + equity (+ drawdown below peak). */
function CurveTooltipContent({
  active,
  payload,
  currency,
  timezone,
  mode,
  metric,
  initial,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CurveDatum }>;
  currency: string;
  timezone: string;
  mode: "equity" | "drawdown";
  /** "percent" → the Y metric is cumPnl in % of the initial balance (§3.1). */
  metric: "currency" | "percent";
  /** Initial balance as a number (> 0 whenever metric === "percent"). */
  initial: number;
}) {
  const fmt = useFormat();
  const pctLabel = usePctLabel();
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  const drawdownPct = initial > 0 ? (point.drawdown / initial) * 100 : 0;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{fmtDateInTz(point.date, timezone)}</p>
      {mode === "equity" ? (
        metric === "percent" ? (
          <p className="mt-1 tabular-nums">{pctLabel(point.value)}</p>
        ) : (
          <p className="mt-1 tabular-nums">
            {fmt.money(point.equity, currency)}
          </p>
        )
      ) : (
        <p className={`mt-1 tabular-nums ${ROSE}`}>
          −{fmt.money(point.drawdown, currency)}
        </p>
      )}
      {mode === "equity" && point.drawdown > 0 ? (
        metric === "percent" ? (
          <p className={`tabular-nums ${ROSE}`}>−{fmt.pct(drawdownPct, 1)}</p>
        ) : (
          <p className={`tabular-nums ${ROSE}`}>
            −{fmt.money(point.drawdown, currency)}
          </p>
        )
      ) : null}
    </div>
  );
}

function CurveChart({
  data,
  currency,
  timezone,
  heightPx,
  mode,
  metric,
  initial,
}: {
  data: CurveDatum[];
  currency: string;
  timezone: string;
  heightPx: number;
  mode: "equity" | "drawdown";
  metric: "currency" | "percent";
  initial: number;
}) {
  const fmt = useFormat();
  const pctLabel = usePctLabel();
  const { reducedMotionActive } = useA11yPrefs();
  // CSS variables work in SVG presentation attributes (verified) — the
  // curves follow the active palette / theme automatically.
  const color = mode === "equity" ? "var(--gain)" : "var(--loss)";
  // §3.1: a masked HIDE mode never draws a real currency scale — the equity
  // curve switches to percent, the fallback (and the drawdown curve) masks.
  const amountsHidden =
    fmt.privacyMode === "HIDE" && fmt.isMasked("amount");
  return (
    <div
      className="w-full"
      style={{ height: heightPx }}
      role="img"
      aria-label={mode === "equity" ? "Equity curve" : "Drawdown curve"}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => fmtDateInTz(value, timezone)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(value: number) =>
              metric === "percent"
                ? pctLabel(value)
                : amountsHidden
                  ? fmt.money(value, currency, 0)
                  : fmtNum(value, 0)
            }
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            cursor={{ strokeOpacity: 0.4 }}
            content={
              <CurveTooltipContent
                currency={currency}
                timezone={timezone}
                mode={mode}
                metric={metric}
                initial={initial}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.15}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={!reducedMotionActive}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CurveWidget({
  data,
  currency,
  timezone,
  heightPx,
  mode,
}: {
  data: unknown;
  currency: string;
  timezone: string;
  heightPx: number;
  mode: "equity" | "drawdown";
}) {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const curveData = asCurveData(data);

  // §3.1 axis switch: with amounts masked in HIDE mode the equity curve plots
  // cumPnl in % of the initial balance instead of currency. Guard: the initial
  // balance must be present and > 0 — otherwise the currency series stays and
  // only the tick formatter masks.
  const initialD = curveData != null ? toD(curveData.initialBalance) : null;
  const hasInitial = initialD != null && initialD.isFinite() && initialD.gt(0);
  const initialNum = hasInitial ? Number(initialD) : 0;
  const usePercent =
    mode === "equity" &&
    fmt.privacyMode === "HIDE" &&
    fmt.isMasked("amount") &&
    hasInitial;

  const points = React.useMemo<CurveDatum[]>(
    () =>
      (curveData?.curve ?? []).map((p) => ({
        date: p.date,
        equity: Number(p.equity),
        cumPnl: Number(p.cumPnl),
        drawdown: Number(p.drawdown),
        value: usePercent
          ? (Number(p.cumPnl) / initialNum) * 100
          : mode === "equity"
            ? Number(p.equity)
            : Number(p.drawdown),
      })),
    [curveData, usePercent, initialNum, mode]
  );

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("equityEmpty")}</p>
    );
  }

  return (
    <>
      <CurveChart
        data={points}
        currency={currency}
        timezone={timezone}
        heightPx={heightPx}
        mode={mode}
        metric={usePercent ? "percent" : "currency"}
        initial={initialNum}
      />
      {mode === "equity" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("equityInitial", {
            amount: fmt.money(curveData?.initialBalance ?? "0", currency),
          })}
        </p>
      ) : null}
    </>
  );
}

export function EquityCurveWidget(props: {
  data: unknown;
  currency: string;
  timezone: string;
  heightPx: number;
}) {
  return <CurveWidget {...props} mode="equity" />;
}

export function DrawdownCurveWidget(props: {
  data: unknown;
  currency: string;
  timezone: string;
  heightPx: number;
}) {
  return <CurveWidget {...props} mode="drawdown" />;
}

export type { CurveWidgetData };
