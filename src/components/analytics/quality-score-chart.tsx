"use client";

/**
 * Trader-score history chart (recharts).
 *
 * Split out of quality-view.tsx so recharts (~349 Ko) is not part of the
 * quality view chunk: quality-view loads this module with next/dynamic
 * (ssr: false) and shows a skeleton while the chart chunk loads.
 */
import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ScoreHistoryPoint {
  month: string;
  score: number;
  trades: number;
}

export function ScoreHistoryChart({
  history,
  label,
  formatSample,
}: {
  history: ScoreHistoryPoint[];
  /** Accessible label for the chart container (history title). */
  label: string;
  /** Sample line under a tooltip point ("n trades"). */
  formatSample: (count: number) => string;
}) {
  return (
    <div className="h-[220px] w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={history}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            strokeOpacity={0.3}
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            cursor={{ strokeOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active) return null;
              const point = payload?.[0]?.payload as
                | ScoreHistoryPoint
                | undefined;
              if (!point) return null;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{point.month}</p>
                  <p className="tabular-nums">{point.score} / 100</p>
                  <p className="tabular-nums text-muted-foreground">
                    {formatSample(point.trades)}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#10b981"
            strokeWidth={2}
            fill="#10b981"
            fillOpacity={0.15}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
