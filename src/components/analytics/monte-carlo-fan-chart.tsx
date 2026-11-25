"use client";

import * as React from "react";
import type { MonteCarloEquityBand } from "@/lib/analytics/monte-carlo";

function money(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

/**
 * Equity fan chart: percentile bands of simulated equity over the trades
 * of a path. The outer band is p5-p95, the inner band p25-p75, the line
 * is the median path. Dashed lines mark the starting balance, the profit
 * target and the ruin floor.
 */
export function MonteCarloFanChart({
  bands,
  bandPaths,
  iterations,
  startingBalance,
  targetPercent,
  ruinThresholdPercent,
  currency,
}: {
  bands: MonteCarloEquityBand[];
  bandPaths: number;
  iterations: number;
  startingBalance: number;
  targetPercent: number;
  ruinThresholdPercent: number;
  currency: string;
}) {
  const targetEquity = startingBalance * (1 + targetPercent / 100);
  const ruinFloor = startingBalance * (1 - ruinThresholdPercent / 100);

  const chart = React.useMemo(() => {
    if (bands.length === 0) return null;
    const W = 640;
    const H = 260;
    const padL = 58;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    const lastStep = bands[bands.length - 1].step;
    const all = bands.flatMap((b) => [b.p5, b.p95]);
    all.push(startingBalance, targetEquity, ruinFloor);
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (min === max) {
      min = min * 0.99 - 1;
      max = max * 1.01 + 1;
    }
    const pad = (max - min) * 0.05;
    min -= pad;
    max += pad;
    const x = (step: number) => padL + (step / Math.max(1, lastStep)) * (W - padL - padR);
    const y = (value: number) => padT + (1 - (value - min) / (max - min)) * (H - padT - padB);
    const line = (pick: (b: MonteCarloEquityBand) => number) =>
      bands.map((b) => `${x(b.step).toFixed(1)},${y(pick(b)).toFixed(1)}`).join(" ");
    const bandPath = (top: (b: MonteCarloEquityBand) => number, bottom: (b: MonteCarloEquityBand) => number) => {
      const forward = bands.map((b) => `${x(b.step).toFixed(1)},${y(top(b)).toFixed(1)}`).join(" ");
      const backward = [...bands].reverse().map((b) => `${x(b.step).toFixed(1)},${y(bottom(b)).toFixed(1)}`).join(" ");
      return `M ${forward} L ${backward} Z`;
    };
    return {
      W,
      H,
      x,
      y,
      min,
      max,
      outer: bandPath((b) => b.p95, (b) => b.p5),
      inner: bandPath((b) => b.p75, (b) => b.p25),
      median: line((b) => b.median),
      lastStep,
    };
  }, [bands, startingBalance, targetEquity, ruinFloor]);

  if (!chart) {
    return <p className="text-sm text-muted-foreground">No trajectory data for this run.</p>;
  }

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="h-64 w-full" role="img" aria-label="Simulated equity paths, percentile bands">
        <path d={chart.outer} className="text-primary" fill="currentColor" fillOpacity={0.12} />
        <path d={chart.inner} className="text-primary" fill="currentColor" fillOpacity={0.22} />
        <line x1={chart.x(0)} x2={chart.x(chart.lastStep)} y1={chart.y(startingBalance)} y2={chart.y(startingBalance)} className="text-muted-foreground" stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" />
        <line x1={chart.x(0)} x2={chart.x(chart.lastStep)} y1={chart.y(targetEquity)} y2={chart.y(targetEquity)} className="text-primary" stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" />
        <line x1={chart.x(0)} x2={chart.x(chart.lastStep)} y1={chart.y(ruinFloor)} y2={chart.y(ruinFloor)} className="text-destructive" stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" />
        <polyline points={chart.median} fill="none" className="text-primary" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <text x={6} y={chart.y(chart.max) + 4} className="fill-muted-foreground" fontSize={11}>{money(chart.max, currency)}</text>
        <text x={6} y={chart.y(chart.min) + 4} className="fill-muted-foreground" fontSize={11}>{money(chart.min, currency)}</text>
        <text x={chart.x(0)} y={chart.H - 8} className="fill-muted-foreground" fontSize={11}>Trade 0</text>
        <text x={chart.x(chart.lastStep)} y={chart.H - 8} textAnchor="end" className="fill-muted-foreground" fontSize={11}>Trade {chart.lastStep}</text>
        <text x={chart.x(chart.lastStep) - 4} y={chart.y(targetEquity) - 5} textAnchor="end" fontSize={11} className="fill-primary">Target +{targetPercent}%</text>
        <text x={chart.x(chart.lastStep) - 4} y={chart.y(ruinFloor) + 14} textAnchor="end" fontSize={11} className="fill-destructive">Ruin -{ruinThresholdPercent}%</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-primary/25" /> p25-p75</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-primary/10" /> p5-p95</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-primary" /> Median path</span>
        <span>Bands from {bandPaths.toLocaleString()} of {iterations.toLocaleString()} simulated paths</span>
      </div>
    </div>
  );
}
