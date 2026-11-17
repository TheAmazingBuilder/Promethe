/**
 * Metrics module — evaluator (v2.5 Module 1, spec §4.6).
 *
 * Evaluates a CustomMetric definition (aggregate + filter groups + optional
 * formula) over closed trades, server-side, on the existing analytics
 * conventions: decimal.js for money, strings at the boundaries.
 *
 * Filter semantics: groups AND, filters inside a group OR (IN semantics).
 * Empty samples → value null + sampleSize 0 (UI shows "n/a" + warning < 10).
 */
import { z } from "zod";
import { D0, Decimal, toD } from "@/lib/trading/dec";
import { evaluateFormula, parseFormula } from "./parser";
import type {
  MetricAggregate,
  metricAggregateSchema,
  metricFilterGroupSchema,
} from "@/lib/validations/dashboard";

// Re-export for convenience.
export type MetricFilterGroup = z.infer<typeof metricFilterGroupSchema>;
export type MetricDefinitionAggregate = z.infer<typeof metricAggregateSchema>;

/** Trade shape the evaluator consumes (superset of StatTrade). */
export interface MetricTrade {
  id: string;
  exitTime: string;
  entryTime: string;
  netPnl: string | null;
  rMultiple: string | null;
  resultType: string | null;
  strategyName: string | null;
  symbol: string;
  direction: string;
  session: string | null;
  lots: string | null;
  pips: string | null;
  riskPercent: string | null;
  emotionBefore: string | null;
  setupType: string | null;
  accountId: string;
  accountName?: string;
  tags: string[];
  /** Local weekday of entry 1 (Mon) → 7 (Sun) - null unknown. */
  localWeekday: number | null;
  /** Local entry hour 0-23 - null unknown. */
  localHour: number | null;
  durationMin: number | null;
}

export interface MetricDefinition {
  aggregate: MetricAggregate;
  filterGroups: MetricFilterGroup[];
  formula?: {
    expression: string;
    subMetrics: Array<{
      name: "A" | "B" | "C";
      aggregate: MetricAggregate;
      filterGroups: MetricFilterGroup[];
    }>;
  } | null;
}

export interface MetricResult {
  /** Decimal-precision string, or null when not computable. */
  value: string | null;
  /** Number of trades in the base sample. */
  sampleSize: number;
  /** True when sampleSize < 10 (UI shows a low-sample warning). */
  lowSample: boolean;
}

// ── Filtering ────────────────────────────────────────────────────────────────

function matchesFilter(trade: MetricTrade, filter: { field: string; values: string[] }): boolean {
  switch (filter.field) {
    case "instrument":
      return filter.values.includes(trade.symbol);
    case "strategy":
      return (
        trade.strategyName != null && filter.values.includes(trade.strategyName)
      );
    case "session":
      return trade.session != null && filter.values.includes(trade.session);
    case "direction":
      return filter.values.includes(trade.direction);
    case "tag":
      return trade.tags.some((tag) => filter.values.includes(tag));
    case "weekday":
      return (
        trade.localWeekday != null &&
        filter.values.includes(String(trade.localWeekday))
      );
    case "hourRange": {
      if (trade.localHour == null) return false;
      return filter.values.some((range) => {
        // "8-10" → hours 8 and 9 (start inclusive, end exclusive).
        const match = range.match(/^(\d{1,2})-(\d{1,2})$/);
        if (!match) return false;
        const start = Number(match[1]);
        const end = Number(match[2]);
        return trade.localHour! >= start && trade.localHour! < end;
      });
    }
    case "emotion":
      return (
        trade.emotionBefore != null &&
        filter.values.includes(trade.emotionBefore)
      );
    case "result":
      return (
        trade.resultType != null && filter.values.includes(trade.resultType)
      );
    case "account":
      return filter.values.includes(trade.accountId);
    case "setupType":
      return (
        trade.setupType != null && filter.values.includes(trade.setupType)
      );
    default:
      return false;
  }
}

function matchesGroup(trade: MetricTrade, group: MetricFilterGroup): boolean {
  return group.filters.some((filter) => matchesFilter(trade, filter));
}

export function applyMetricFilters(
  trades: MetricTrade[],
  filterGroups: MetricFilterGroup[]
): MetricTrade[] {
  if (filterGroups.length === 0) return trades;
  return trades.filter((t) => filterGroups.every((g) => matchesGroup(t, g)));
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function median(values: Decimal[]): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? sorted[mid - 1]!.plus(sorted[mid]!).div(2)
    : sorted[mid]!;
}

function computeAggregate(
  aggregate: MetricAggregate,
  trades: MetricTrade[]
): string | null {
  if (aggregate === "count") return String(trades.length);

  const pnl = trades.map((t) => toD(t.netPnl ?? "0"));
  const rTrades = trades.filter((t) => t.rMultiple != null);
  const rValues = rTrades.map((t) => toD(t.rMultiple!));
  const wins = pnl.filter((p) => p.gt(D0));
  const losses = pnl.filter((p) => p.lt(D0));

  switch (aggregate) {
    case "winRate": {
      if (trades.length === 0) return null;
      const winsCount = trades.filter(
        (t) =>
          t.resultType === "WIN" ||
          (t.resultType == null && toD(t.netPnl ?? "0").gt(D0))
      ).length;
      return new Decimal(winsCount).times(100).div(trades.length).toFixed(2);
    }
    case "netPnl":
      return pnl.length === 0 ? null : pnl.reduce((a, b) => a.plus(b), D0).toString();
    case "grossWin":
      return wins.length === 0 ? null : wins.reduce((a, b) => a.plus(b), D0).toString();
    case "grossLoss":
      return losses.length === 0
        ? null
        : losses.reduce((a, b) => a.plus(b), D0).toString();
    case "avgPnl":
      return pnl.length === 0 ? null : pnl.reduce((a, b) => a.plus(b), D0).div(pnl.length).toString();
    case "medianPnl": {
      const med = median(pnl);
      return med == null ? null : med.toString();
    }
    case "avgR":
      return rValues.length === 0
        ? null
        : rValues.reduce((a, b) => a.plus(b), D0).div(rValues.length).toString();
    case "totalR":
      return rValues.length === 0
        ? null
        : rValues.reduce((a, b) => a.plus(b), D0).toString();
    case "profitFactor": {
      const grossWin = wins.reduce((a, b) => a.plus(b), D0);
      const grossLoss = losses.reduce((a, b) => a.plus(b), D0).abs();
      if (grossLoss.isZero()) return wins.length === 0 ? null : "inf";
      return grossWin.div(grossLoss).toFixed(3);
    }
    case "expectancyR":
      return rValues.length === 0
        ? null
        : rValues.reduce((a, b) => a.plus(b), D0).div(rValues.length).toString();
    case "expectancyCurrency":
      return pnl.length === 0
        ? null
        : pnl.reduce((a, b) => a.plus(b), D0).div(pnl.length).toString();
    case "totalPips": {
      const pips = trades.filter((t) => t.pips != null).map((t) => toD(t.pips!));
      return pips.length === 0
        ? null
        : pips.reduce((a, b) => a.plus(b), D0).toString();
    }
    case "avgLots": {
      const lots = trades.filter((t) => t.lots != null).map((t) => toD(t.lots!));
      return lots.length === 0
        ? null
        : lots.reduce((a, b) => a.plus(b), D0).div(lots.length).toString();
    }
    case "avgDurationMin": {
      const durations = trades
        .filter((t) => t.durationMin != null)
        .map((t) => t.durationMin!);
      if (durations.length === 0) return null;
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      return String(Math.round(avg));
    }
    case "payoffRatio": {
      const avgWin = wins.length === 0 ? null : wins.reduce((a, b) => a.plus(b), D0).div(wins.length);
      const avgLoss = losses.length === 0 ? null : losses.reduce((a, b) => a.plus(b), D0).div(losses.length).abs();
      if (avgWin == null || avgLoss == null || avgLoss.isZero()) return null;
      return avgWin.div(avgLoss).toFixed(3);
    }
    default:
      return null;
  }
}

/** "inf" sentinel from profitFactor → numeric Infinity for formulas. */
function toFormulaNumber(value: string | null): number | null {
  if (value == null) return null;
  if (value === "inf") return Number.POSITIVE_INFINITY;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function evaluateMetric(
  definition: MetricDefinition,
  trades: MetricTrade[]
): MetricResult {
  const sample = applyMetricFilters(trades, definition.filterGroups);
  const lowSample = sample.length < 10;

  if (!definition.formula) {
    const value = computeAggregate(definition.aggregate, sample);
    return {
      value,
      sampleSize: sample.length,
      lowSample: lowSample && sample.length > 0,
    };
  }

  // Formula mode: evaluate each sub-metric on its own filtered sample,
  // then combine with the safe parser. Sample size = union base (no filters).
  const variables: Record<string, number | null> = {};
  for (const sub of definition.formula.subMetrics) {
    const subSample = applyMetricFilters(trades, sub.filterGroups);
    variables[sub.name] = toFormulaNumber(computeAggregate(sub.aggregate, subSample));
  }

  let node;
  try {
    node = parseFormula(definition.formula.expression);
  } catch {
    return {
      value: null,
      sampleSize: sample.length,
      lowSample: lowSample && sample.length > 0,
    };
  }

  const numeric = evaluateFormula(node, variables);
  return {
    value: numeric == null || !Number.isFinite(numeric) ? null : String(numeric),
    sampleSize: sample.length,
    lowSample: lowSample && sample.length > 0,
  };
}
