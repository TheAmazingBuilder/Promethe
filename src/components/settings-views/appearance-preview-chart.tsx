"use client";

/**
 * Appearance palette preview chart (recharts).
 *
 * Split out of appearance-view.tsx so recharts (~349 Ko) is not part of the
 * settings chunk: appearance-view loads this module with next/dynamic
 * (ssr: false). The bars use the CSS chart tokens (var(--chart-n)) set on
 * the parent preview box, so the live palette still applies.
 */
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

const PREVIEW_DATA = [
  { name: "A", v: 12 },
  { name: "B", v: 19 },
  { name: "C", v: 8 },
  { name: "D", v: 24 },
  { name: "E", v: 15 },
];

export function AppearancePreviewChart({
  label,
  reducedMotion,
}: {
  /** Accessible label for the chart container. */
  label: string;
  reducedMotion: boolean;
}) {
  return (
    <div className="h-36 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={PREVIEW_DATA}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            strokeOpacity={0.3}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <Tooltip cursor={{ fillOpacity: 0.1 }} />
          <Bar
            dataKey="v"
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
            isAnimationActive={!reducedMotion}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <Cell key={n} fill={`var(--chart-${n})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
