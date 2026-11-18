"use client";

/**
 * ChartTable — accessible table fallback for a ChartResult (same data as
 * the chart, rows instead of bars). Split out of chart-preview.tsx: the
 * builder imports it statically, so it must not live in the recharts
 * module.
 */
import * as React from "react";
import type { ChartResult } from "@/lib/charts/builder";
import { fmtNum } from "@/lib/format";
import {
  formatMeasureValue,
  type MeasureFormatKind,
} from "./chart-format";

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
