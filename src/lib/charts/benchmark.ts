/**
 * TradeJournal — equity benchmark engine (v2.5 Module 2, spec §4.5).
 *
 * PURE and client-safe: builds benchmark series (fixed % per period —
 * compounding or linear, fixed R per period, or an imported custom series)
 * and compares them to the realized equity curve. Both sides are normalized
 * to a common base (start = 100) so currency / R units compare directly.
 * Deposits/withdrawals are already excluded by the v1 equity convention
 * (initialBalance + cumulative closed P&L only).
 *
 * Period boundaries are computed in UTC calendar terms (series dates are UTC
 * ISO strings — DST shifts never move UTC calendar borders; see tests).
 * `monthlyReturns` buckets by LOCAL calendar months in the user's timezone.
 */
import { toD } from "@/lib/trading/dec";

// ── Types ────────────────────────────────────────────────────────────────────

export type BenchmarkPeriodUnit = "MONTH" | "WEEK" | "YEAR";

export interface BenchmarkParams {
  /** Percent per period (FIXED_PERCENT_PER_PERIOD). */
  percent?: number;
  /** R added per period (FIXED_R_PER_PERIOD). */
  rPerPeriod?: number;
  period: BenchmarkPeriodUnit;
  compounding: boolean;
  /** ISO date - benchmark start. */
  startDate: string;
  /** Base balance for percent benchmarks (defaults to the equity start). */
  startBalance?: string;
}

export interface BenchmarkPoint {
  /** ISO date (period boundary or today). */
  date: string;
  value: number;
}

export interface EquityPointLite {
  /** ISO exit date. */
  date: string;
  equity: number;
}

// ── Calendar helpers (timezone-aware, pure) ──────────────────────────────────

interface LocalYMD {
  y: number;
  m: number; // 1-12
  d: number;
}

function localYMD(date: Date, timezone: string): LocalYMD | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return {
      y: Number(parts.year),
      m: Number(parts.month),
      d: Number(parts.day),
    };
  } catch {
    return null;
  }
}

/**
 * Next period boundary strictly after `date`, in UTC calendar terms (the
 * series dates are UTC ISO strings; DST shifts never move UTC calendar
 * borders — see tests). A hard safety advance guarantees progress even for
 * pathological inputs.
 */
function nextBoundary(date: Date, unit: BenchmarkPeriodUnit, _timezone: string): Date | null {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-11
  const d = date.getUTCDate();
  let next: Date;
  if (unit === "MONTH") {
    next = m === 11 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m + 1, 1));
  } else if (unit === "YEAR") {
    next = new Date(Date.UTC(y + 1, 0, 1));
  } else {
    // WEEK: next Monday (same-day Monday counts as the current boundary).
    const dow = date.getUTCDay(); // 0 = Sunday
    const daysToMonday = dow === 1 ? 7 : (8 - dow) % 7;
    next = new Date(date.getTime() + daysToMonday * 86400_000);
    next = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()));
  }
  if (next.getTime() <= date.getTime()) {
    // Safety: always advance at least one day.
    next = new Date(date.getTime() + 86400_000);
  }
  return next;
}

/** Elapsed fraction of the current (partial) period, 0..1. */
function partialFraction(
  lastBoundary: Date,
  next: Date,
  at: Date
): number {
  const total = next.getTime() - lastBoundary.getTime();
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (at.getTime() - lastBoundary.getTime()) / total));
}

// ── Series builders ──────────────────────────────────────────────────────────

export function buildFixedBenchmark(
  params: BenchmarkParams,
  endDate: string,
  timezone = "UTC"
): BenchmarkPoint[] {
  const start = new Date(params.startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return [];
  }
  const balance =
    params.startBalance != null ? Number(params.startBalance) : 100;
  const isR = params.rPerPeriod != null;
  const rate = isR ? params.rPerPeriod! : (params.percent ?? 0) / 100;
  if (!Number.isFinite(rate)) return [];

  const points: BenchmarkPoint[] = [{ date: params.startDate, value: balance }];
  let boundary = start;
  let k = 0;
  // Walk period boundaries from the start.
  for (;;) {
    const next = nextBoundary(boundary, params.period, timezone);
    if (next == null || next >= end) break;
    if (next > boundary) {
      k += 1;
      const value = isR
        ? balance + rate * k
        : params.compounding
          ? balance * Math.pow(1 + rate, k)
          : balance * (1 + rate * k);
      points.push({ date: next.toISOString(), value });
    }
    boundary = next;
  }
  // Final point at `end`, prorated for the partial period.
  const next = nextBoundary(boundary, params.period, timezone);
  if (next != null && next > boundary) {
    const frac = partialFraction(boundary, next, end);
    const value = isR
      ? balance + rate * (k + frac)
      : params.compounding
        ? balance * Math.pow(1 + rate, k + frac)
        : balance * (1 + rate * (k + frac));
    points.push({ date: end.toISOString(), value });
  }
  return points;
}

// ── Comparison ───────────────────────────────────────────────────────────────

export interface ComparisonPoint {
  date: string;
  equityIndex: number | null;
  benchmarkIndex: number | null;
}

export interface PeriodComparison {
  start: string;
  end: string;
  equityReturn: number | null; // %
  benchmarkReturn: number | null; // %
  beaten: boolean | null;
}

export interface ComparisonResult {
  /** Both curves normalized to 100 at the common start. */
  points: ComparisonPoint[];
  /** One entry per benchmark period fully inside the comparable window
   * (both sides observed at both ends) - `beaten` is never null here. */
  periods: PeriodComparison[];
  /** Share of comparable periods where the equity beat the benchmark (0-100). */
  beatRate: number | null;
  /** equityIndex − benchmarkIndex at the last common date (points). */
  gapAtEnd: number | null;
  /** First date of the comparable window (later of the two starts). */
  firstDate: string | null;
  /** Last date of the comparable window (earlier of the two ends). */
  lastDate: string | null;
}

/** Value of a series at or before a date (last known, linear-free). */
function valueAt(series: Array<{ date: string; value: number }>, at: string): number | null {
  let v: number | null = null;
  for (const p of series) {
    if (p.date <= at) v = p.value;
    else break;
  }
  return v;
}

export function compareEquityToBenchmark(
  equity: EquityPointLite[],
  benchmark: BenchmarkPoint[],
  options?: { unit?: BenchmarkPeriodUnit; timezone?: string }
): ComparisonResult {
  if (equity.length === 0 || benchmark.length === 0) {
    return {
      points: [],
      periods: [],
      beatRate: null,
      gapAtEnd: null,
      firstDate: null,
      lastDate: null,
    };
  }
  const timezone = options?.timezone ?? "UTC";

  // Normalize property names: equity points carry `equity`, benchmarks
  // `value`. Both series are sorted here so the comparison never depends
  // on the caller's order (valueAt walks each series in order).
  const eqSeries = equity
    .map((p) => ({ date: p.date, value: p.equity }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const bmSeries = [...benchmark].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Common window: start at the later of the two starts, and end at the
  // earlier of the two ends. Past the last observed point of either side
  // there is no data - carrying a flat value forward would compare the
  // benchmark against an equity that simply stopped being observed (a
  // custom series that runs past the last trade, or an equity curve that
  // runs past the end of an imported series). Only the overlap is
  // comparable, so the window is clamped to it on both sides.
  const start =
    eqSeries[0].date > bmSeries[0].date ? eqSeries[0].date : bmSeries[0].date;
  const eqBase = valueAt(eqSeries, start);
  const bmBase = valueAt(bmSeries, start);
  if (eqBase == null || bmBase == null || eqBase === 0 || bmBase === 0) {
    return {
      points: [],
      periods: [],
      beatRate: null,
      gapAtEnd: null,
      firstDate: null,
      lastDate: null,
    };
  }
  const eqLast = eqSeries[eqSeries.length - 1].date;
  const bmLast = bmSeries[bmSeries.length - 1].date;
  const lastDate = eqLast < bmLast ? eqLast : bmLast;
  if (lastDate < start) {
    // No overlap at all (one series ends before the other starts).
    return {
      points: [],
      periods: [],
      beatRate: null,
      gapAtEnd: null,
      firstDate: null,
      lastDate: null,
    };
  }

  // Union of dates (equity exits + benchmark boundaries) within the window.
  const dates = Array.from(
    new Set(
      [
        ...eqSeries.map((p) => p.date),
        ...bmSeries.map((p) => p.date),
      ].filter((d) => d >= start && d <= lastDate)
    )
  ).sort();

  const points: ComparisonPoint[] = dates.map((date) => {
    const eq = valueAt(eqSeries, date);
    const bm = valueAt(bmSeries, date);
    return {
      date,
      equityIndex: eq != null ? (eq / eqBase) * 100 : null,
      benchmarkIndex: bm != null ? (bm / bmBase) * 100 : null,
    };
  });

  // Period-by-period comparison over benchmark boundaries inside the
  // window (every period here has both sides observed, so `beaten` is
  // never null - periods.length is the comparable period count).
  const periods: PeriodComparison[] = [];
  const boundaries = bmSeries
    .map((p) => p.date)
    .filter((d) => d >= start && d <= lastDate);
  for (let i = 1; i < boundaries.length; i += 1) {
    const pStart = boundaries[i - 1];
    const pEnd = boundaries[i];
    const eqA = valueAt(eqSeries, pStart);
    const eqB = valueAt(eqSeries, pEnd);
    const bmA = valueAt(bmSeries, pStart);
    const bmB = valueAt(bmSeries, pEnd);
    const eqReturn =
      eqA != null && eqB != null && eqA !== 0 ? ((eqB - eqA) / eqA) * 100 : null;
    const bmReturn =
      bmA != null && bmB != null && bmA !== 0 ? ((bmB - bmA) / bmA) * 100 : null;
    periods.push({
      start: pStart,
      end: pEnd,
      equityReturn: eqReturn,
      benchmarkReturn: bmReturn,
      beaten:
        eqReturn != null && bmReturn != null ? eqReturn > bmReturn : null,
    });
  }

  const comparable = periods.filter((p) => p.beaten != null);
  const beatRate =
    comparable.length > 0
      ? (comparable.filter((p) => p.beaten).length / comparable.length) * 100
      : null;

  const last = points[points.length - 1];
  const gapAtEnd =
    last.equityIndex != null && last.benchmarkIndex != null
      ? last.equityIndex - last.benchmarkIndex
      : null;

  return {
    points,
    periods,
    beatRate,
    gapAtEnd,
    firstDate: start,
    lastDate,
  };
}

// ── Goal math ────────────────────────────────────────────────────────────────

/**
 * Required return per month to grow `current` into `goal` in `monthsLeft`
 * months (compounding). Null when impossible (months ≤ 0, current ≤ 0).
 */
export function requiredMonthlyReturn(
  current: number,
  goal: number,
  monthsLeft: number
): number | null {
  if (monthsLeft <= 0 || current <= 0 || goal <= 0) return null;
  const ratio = goal / current;
  const monthly = Math.pow(ratio, 1 / monthsLeft) - 1;
  return monthly * 100;
}

// ── Projection cone (simple, assumption-labelled) ────────────────────────────

export interface ProjectionCone {
  months: number;
  low: number[];
  base: number[];
  high: number[];
  /** Mean monthly return over the realized sample (%). */
  meanMonthlyReturn: number;
  /** Standard deviation of monthly returns (% points). */
  stdMonthlyReturn: number;
}

/**
 * Cone from the realized monthly returns: base = mean compounded, bands =
 * mean ± 1 std compounded. Assumptions are labelled in the UI (normal i.i.d.
 * months — a simplification, not a forecast).
 */
export function projectionCone(
  monthlyReturnsPct: number[],
  currentValue: number,
  monthsAhead: number
): ProjectionCone | null {
  if (monthlyReturnsPct.length < 2 || monthsAhead <= 0 || currentValue <= 0) {
    return null;
  }
  const n = monthlyReturnsPct.length;
  const mean = monthlyReturnsPct.reduce((a, b) => a + b, 0) / n;
  const variance =
    monthlyReturnsPct.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const std = Math.sqrt(variance);

  const low: number[] = [];
  const base: number[] = [];
  const high: number[] = [];
  for (let m = 1; m <= monthsAhead; m += 1) {
    low.push(currentValue * Math.pow(1 + (mean - std) / 100, m));
    base.push(currentValue * Math.pow(1 + mean / 100, m));
    high.push(currentValue * Math.pow(1 + (mean + std) / 100, m));
  }
  return {
    months: monthsAhead,
    low,
    base,
    high,
    meanMonthlyReturn: mean,
    stdMonthlyReturn: std,
  };
}

/** Monthly returns (%) of an equity curve, in `timezone` calendar months. */
export function monthlyReturns(
  equity: EquityPointLite[],
  timezone = "UTC"
): number[] {
  if (equity.length < 2) return [];
  const monthValue = new Map<string, number>();
  for (const p of equity) {
    const ymd = localYMD(new Date(p.date), timezone);
    if (!ymd) continue;
    monthValue.set(`${ymd.y}-${String(ymd.m).padStart(2, "0")}`, p.equity);
  }
  const keys = [...monthValue.keys()].sort();
  const returns: number[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    const a = monthValue.get(keys[i - 1])!;
    const b = monthValue.get(keys[i])!;
    if (a !== 0) returns.push(((b - a) / a) * 100);
  }
  return returns;
}

/** Decimal helper re-export for consumers building equity inputs. */
export { toD };
