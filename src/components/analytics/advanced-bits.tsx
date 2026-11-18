"use client";

/**
 * Shared building blocks for the advanced analytics tabs (v2.5 Module 6).
 */
import * as React from "react";
import { fmtNum, fmtSigned } from "@/lib/format";

/** Compact KPI card, same shape as the analytics overview. */
export function AdvKpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub != null ? (
        <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/** Format an R multiple for display ("+1.25 R", "-" when null). */
export function fmtR(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${fmtSigned(value.toFixed(digits))} R`;
}

/** Format a ratio as a plain number ("0.85", "-" when null). */
export function fmtRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return fmtNum(value, 2);
}

/** Format a percent value ("62.5 %", "-" when null). */
export function fmtPctValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${fmtNum(value, 1)} %`;
}

/** Horizontal bucket bars (distribution over R buckets). */
export function BucketBars({
  buckets,
  formatLabel,
}: {
  buckets: Array<{ id: string; from: number | null; to: number | null; count: number }>;
  formatLabel: (b: { id: string; from: number | null; to: number | null }) => string;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <ul className="space-y-1.5">
      {buckets.map((b) => (
        <li
          key={b.id}
          className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm"
        >
          <span
            className="absolute inset-y-0 left-0 bg-gain-subtle"
            style={{ width: max > 0 ? `${Math.max(2, (b.count / max) * 100)}%` : 0 }}
            aria-hidden="true"
          />
          <span className="relative z-10 min-w-0 truncate font-medium">
            {formatLabel(b)}
          </span>
          <span className="relative z-10 shrink-0 tabular-nums text-muted-foreground">
            ×{b.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Human duration from minutes ("2h 15m" / "45 min"). */
export function fmtDurationMin(
  minutes: number | null | undefined,
  formatMinutes: (m: number) => string,
  formatHoursMinutes: (h: number, m: number) => string
): string {
  if (minutes == null || !Number.isFinite(minutes)) return "-";
  if (minutes < 60) return formatMinutes(minutes);
  return formatHoursMinutes(Math.floor(minutes / 60), minutes % 60);
}
