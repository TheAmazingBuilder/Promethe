/**
 * Chart formatting helpers — pure functions, no recharts, no React.
 *
 * Split out of chart-preview.tsx so the chart builder, heatmaps and table
 * fallback can import these without pulling the whole recharts renderer
 * (and its 349 Ko) into their chunk. ChartPreview itself stays in
 * chart-preview.tsx and is loaded with next/dynamic.
 */
import {
  MONTH_KEY_LIST,
  WEEKDAY_KEY_LIST,
} from "@/lib/charts/builder";
import type { XDimension, YMeasure } from "@/lib/validations/charts";
import { fmtNum } from "@/lib/format";

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
