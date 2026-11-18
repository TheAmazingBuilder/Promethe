"use client";

/**
 * Analytics charts — equity curve + drawdown and R distribution (recharts).
 *
 * Split out of analytics-view.tsx so recharts (~349 Ko) is not part of the
 * analytics view chunk: analytics-view loads this module with next/dynamic
 * (ssr: false) and shows a skeleton while the chart chunk loads.
 */
import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/privacy/money";
import {
  fmtDateInTz,
  fmtSigned,
} from "@/lib/format";

const ROSE = "text-loss";

export interface EquityDatum {
  i: number;
  date: string;
  equity: number;
  drawdown: number;
}

function EquityTooltipContent({
  active,
  payload,
  currency,
  timezone,
}: {
  active?: boolean;
  payload?: Array<{ payload?: EquityDatum }>;
  currency: string;
  timezone: string;
}) {
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">#{point.i}</p>
      <p className="text-muted-foreground">
        {fmtDateInTz(point.date, timezone)}
      </p>
      <p className="mt-1 tabular-nums">
        <Money value={point.equity} currency={currency} kind="balance" />
      </p>
      {point.drawdown > 0 ? (
        <p className={`tabular-nums ${ROSE}`}>
          −<Money value={point.drawdown} currency={currency} />
        </p>
      ) : null}
    </div>
  );
}

function RDistTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; count: number; totalR: number } }>;
}) {
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{point.label}</p>
      <p className="tabular-nums">{point.count}</p>
      <p className="tabular-nums text-muted-foreground">
        Σ {fmtSigned(String(point.totalR))} R
      </p>
    </div>
  );
}

export interface AnalyticsChartsProps {
  equityData: EquityDatum[];
  rDistData: Array<{
    id: string;
    label: string;
    count: number;
    totalR: number;
    negative: boolean;
  }>;
  currency: string;
  timezone: string;
  reducedMotion: boolean;
  /** Money formatter from useFormat (parent owns privacy/placeholder rules). */
  formatMoney: (
    value: number,
    currency: string,
    decimals?: number
  ) => string;
  equityTitle: string;
  equityDesc: string;
  drawdownTitle: string;
  rdistTitle: string;
  rdistDesc: string;
  rdistDescMissing: string;
  missingCount: number;
}

export function AnalyticsCharts({
  equityData,
  rDistData,
  currency,
  timezone,
  reducedMotion,
  formatMoney,
  equityTitle,
  equityDesc,
  drawdownTitle,
  rdistTitle,
  rdistDesc,
  rdistDescMissing,
  missingCount,
}: AnalyticsChartsProps) {
  // Same grid + cards as before, with the parent's locals renamed to props:
  // t("equityTitle") -> equityTitle, fmt.money -> formatMoney,
  // reducedMotionActive -> reducedMotion, data.rDistribution.withoutR ->
  // missingCount, t("rdistDesc*") -> rdistDesc / rdistDescMissing.
  return (
              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">{equityTitle}</CardTitle>
                    <CardDescription>{equityDesc}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div
                      className="h-[220px] w-full"
                      role="img"
                      aria-label={equityTitle}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={equityData}
                          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            strokeOpacity={0.3}
                            vertical={false}
                          />
                          <XAxis
                            dataKey="i"
                            tickFormatter={(value: number) => `#${value}`}
                            tick={{ fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={32}
                          />
                          <YAxis
                            domain={["auto", "auto"]}
                            tickFormatter={(value: number) => formatMoney(value, currency, 0)}
                            tick={{ fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={60}
                          />
                          <Tooltip
                            cursor={{ strokeOpacity: 0.4 }}
                            content={
                              <EquityTooltipContent
                                currency={currency}
                                timezone={timezone}
                              />
                            }
                          />
                          <Area
                            type="monotone"
                            dataKey="equity"
                            stroke="#10b981"
                            strokeWidth={2}
                            fill="#10b981"
                            fillOpacity={0.15}
                            dot={false}
                            activeDot={{ r: 4 }}
                            isAnimationActive={!reducedMotion}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {drawdownTitle}
                      </p>
                      <div
                        className="h-[80px] w-full"
                        role="img"
                        aria-label={drawdownTitle}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={equityData}
                            margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
                          >
                            <XAxis dataKey="i" hide />
                            <YAxis
                              domain={[0, "auto"]}
                              tickFormatter={(value: number) => formatMoney(value, currency, 0)}
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              width={60}
                            />
                            <Tooltip
                              cursor={{ strokeOpacity: 0.4 }}
                              content={
                                <EquityTooltipContent
                                  currency={currency}
                                  timezone={timezone}
                                />
                              }
                            />
                            <Area
                              type="monotone"
                              dataKey="drawdown"
                              stroke="#f43f5e"
                              strokeWidth={1.5}
                              fill="#f43f5e"
                              fillOpacity={0.15}
                              dot={false}
                              isAnimationActive={!reducedMotion}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{rdistTitle}</CardTitle>
                    <CardDescription>
                      {missingCount > 0 ? rdistDescMissing : rdistDesc}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      className="h-[320px] w-full"
                      role="img"
                      aria-label={rdistTitle}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={rDistData}
                          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            strokeOpacity={0.3}
                            vertical={false}
                          />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            angle={-35}
                            textAnchor="end"
                            height={44}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={32}
                          />
                          <Tooltip
                            cursor={{ fillOpacity: 0.08 }}
                            content={<RDistTooltipContent />}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={!reducedMotion}>
                            {rDistData.map((b) => (
                              <Cell
                                key={b.id}
                                fill={b.negative ? "var(--loss)" : "var(--gain)"}
                                fillOpacity={0.8}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
  );
}
