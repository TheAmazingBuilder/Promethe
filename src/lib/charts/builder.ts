/**
 * TradeJournal — chart builder engine (v2.5 Module 2, spec §4.1).
 *
 * PURE and client-safe (no Prisma, no React): takes filtered CLOSED trades
 * plus a ChartConfig and produces render-ready series, sample sizes, warnings
 * and drill-down descriptors. All numeric aggregation goes through decimal.js
 * for exactness; only final display values are converted to JS numbers.
 *
 * Timezone-aware fields (localHour, localWeekday, …) are computed upstream in
 * the user's timezone by the server module — same convention as the analytics
 * engine (see /src/server/charts.ts).
 */
import { D0, Decimal, toD } from "@/lib/trading/dec";
import { computeTradeStats, type StatTrade } from "@/lib/analytics/engine";
import type {
  Aggregation,
  ChartConfig,
  ChartType,
  GroupBy,
  NumericXMeasure,
  XDimension,
  YMeasure,
} from "@/lib/validations/charts";

// ── Input shape ──────────────────────────────────────────────────────────────

/** Closed trade with every builder dimension (client-safe mirror of the API payload). */
export interface BuilderTrade extends StatTrade {
  accountId: string;
  accountName: string;
  timeframe: string | null;
  setupType: string | null;
  marketCondition: string | null;
  exitReason: string | null;
  emotionBefore: string | null;
  emotionDuring: string | null;
  emotionAfter: string | null;
  confidence: number | null;
  setupQualityRating: number | null;
  followedPlan: boolean | null;
  pips: string | null;
  points: string | null;
  riskPercent: string | null;
  /** MFE/MAE expressed in R (computed server-side — excursionR below). */
  mfeR: string | null;
  maeR: string | null;
  /** Trade duration in minutes (exit − entry). */
  durationMin: number | null;
  /** All tag names on the trade. */
  tags: string[];
  /** MISTAKE-kind tag names. */
  mistakes: string[];
  // Timezone-aware local parts (user's profile timezone, computed server-side)
  /** Local calendar date of the EXIT (YYYY-MM-DD) — P&L attribution. */
  localDate: string | null;
  /** Local calendar date of the ENTRY (YYYY-MM-DD). */
  localEntryDate: string | null;
  /** Local weekday of the ENTRY, 1 (Monday) → 7 (Sunday). */
  localWeekday: number | null;
  /** Local hour of the ENTRY, 0-23. */
  localHour: number | null;
  /** Local month of the ENTRY, 1-12. */
  localMonth: number | null;
  /** Local day-of-month of the ENTRY, 1-31. */
  localDayOfMonth: number | null;
  /** ISO week number of the ENTRY date. */
  localIsoWeek: number | null;
}

// ── MFE / MAE in R (pure helper, reused by the server mapper) ────────────────

/**
 * Max favorable / adverse excursion expressed in R multiples.
 * risk-per-unit = |entry − initial SL| (fallback: final SL); direction aware.
 * Returns null when the extremes or the risk distance are missing.
 */
export function excursionR(
  direction: string,
  entryPrice: string | number | null,
  mfePrice: string | number | null,
  maePrice: string | number | null,
  initialStopLoss: string | number | null,
  stopLoss: string | number | null
): { mfeR: string | null; maeR: string | null } {
  const none = { mfeR: null, maeR: null };
  if (entryPrice == null) return none;
  const entry = toD(entryPrice);
  const sl = initialStopLoss ?? stopLoss;
  if (sl == null) return none;
  const risk = entry.minus(toD(sl)).abs();
  if (risk.lte(0)) return none;

  const long = direction === "LONG";
  let mfeR: string | null = null;
  let maeR: string | null = null;
  if (mfePrice != null) {
    const fav = long ? toD(mfePrice).minus(entry) : entry.minus(toD(mfePrice));
    mfeR = fav.div(risk).toString();
  }
  if (maePrice != null) {
    const adv = long ? entry.minus(toD(maePrice)) : toD(maePrice).minus(entry);
    maeR = adv.div(risk).toString();
  }
  return { mfeR, maeR };
}

// ── Buckets ──────────────────────────────────────────────────────────────────

export interface Bucket {
  key: string;
  /** Sort rank for "natural" ordering. */
  rank: number;
}

const HOLDING_BUCKETS: Bucket[] = [
  { key: "under5m", rank: 1 },
  { key: "5to15m", rank: 2 },
  { key: "15to60m", rank: 3 },
  { key: "1to4h", rank: 4 },
  { key: "4to24h", rank: 5 },
  { key: "over24h", rank: 6 },
];

const LOT_BUCKETS: Bucket[] = [
  { key: "under0.1", rank: 1 },
  { key: "0.1to0.5", rank: 2 },
  { key: "0.5to1", rank: 3 },
  { key: "1to2", rank: 4 },
  { key: "2to5", rank: 5 },
  { key: "over5", rank: 6 },
];

const RISK_BUCKETS: Bucket[] = [
  { key: "under0.25", rank: 1 },
  { key: "0.25to0.5", rank: 2 },
  { key: "0.5to1", rank: 3 },
  { key: "1to2", rank: 4 },
  { key: "over2", rank: 5 },
];

function holdingBucket(min: number | null): string | null {
  if (min == null) return null;
  if (min < 5) return "under5m";
  if (min < 15) return "5to15m";
  if (min < 60) return "15to60m";
  if (min < 240) return "1to4h";
  if (min < 1440) return "4to24h";
  return "over24h";
}

function lotBucket(lots: string | null): string | null {
  if (lots == null) return null;
  const v = toD(lots);
  if (v.lt(0.1)) return "under0.1";
  if (v.lt(0.5)) return "0.1to0.5";
  if (v.lt(1)) return "0.5to1";
  if (v.lt(2)) return "1to2";
  if (v.lt(5)) return "2to5";
  return "over5";
}

function riskBucket(risk: string | null): string | null {
  if (risk == null) return null;
  const v = toD(risk);
  if (v.lt(0.25)) return "under0.25";
  if (v.lt(0.5)) return "0.25to0.5";
  if (v.lt(1)) return "0.5to1";
  if (v.lt(2)) return "1to2";
  return "over2";
}

// ── Dimension registry ───────────────────────────────────────────────────────

export interface DimensionDef {
  key: XDimension;
  /** i18n label key under chartsBuilder.dimensions.*. */
  labelKey: string;
  /** Multi-value dimensions fan a trade out over several categories. */
  multi: boolean;
  /** Natural sort: "rank" (fixed order) | "alpha" | "chrono" | "numeric". */
  order: "rank" | "alpha" | "chrono" | "numeric";
  /** Fixed rank map (order = rank). */
  ranks?: Record<string, number>;
  /** Category keys with a stable presence (hour 0-23…). */
  domain?: string[];
}

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_KEYS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const X_DIMENSION_DEFS: DimensionDef[] = [
  { key: "hourOfDay", labelKey: "hourOfDay", multi: false, order: "rank", ranks: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h])), domain: Array.from({ length: 24 }, (_, h) => String(h)) },
  { key: "dayOfWeek", labelKey: "dayOfWeek", multi: false, order: "rank", ranks: Object.fromEntries(WEEKDAY_KEYS.map((d, i) => [d, i + 1])), domain: WEEKDAY_KEYS },
  { key: "dayOfMonth", labelKey: "dayOfMonth", multi: false, order: "rank", ranks: Object.fromEntries(Array.from({ length: 31 }, (_, d) => [String(d + 1), d + 1])), domain: Array.from({ length: 31 }, (_, d) => String(d + 1)) },
  { key: "month", labelKey: "month", multi: false, order: "rank", ranks: Object.fromEntries(MONTH_KEYS.map((m, i) => [m, i + 1])), domain: MONTH_KEYS },
  { key: "week", labelKey: "week", multi: false, order: "numeric" },
  { key: "session", labelKey: "session", multi: false, order: "rank", ranks: { ASIAN: 1, LONDON: 2, OVERLAP: 3, NEW_YORK: 4, OTHER: 5 } },
  { key: "instrument", labelKey: "instrument", multi: false, order: "alpha" },
  { key: "strategy", labelKey: "strategy", multi: false, order: "alpha" },
  { key: "direction", labelKey: "direction", multi: false, order: "rank", ranks: { LONG: 1, SHORT: 2 }, domain: ["LONG", "SHORT"] },
  { key: "timeframe", labelKey: "timeframe", multi: false, order: "rank", ranks: { M1: 1, M5: 2, M15: 3, M30: 4, H1: 5, H4: 6, D1: 7, W1: 8, MN: 9 } },
  { key: "setupType", labelKey: "setupType", multi: false, order: "alpha" },
  { key: "marketCondition", labelKey: "marketCondition", multi: false, order: "rank", ranks: { TRENDING: 1, RANGING: 2, VOLATILE: 3, NEWS: 4, OTHER: 5 } },
  { key: "emotionBefore", labelKey: "emotionBefore", multi: false, order: "alpha" },
  { key: "emotionDuring", labelKey: "emotionDuring", multi: false, order: "alpha" },
  { key: "emotionAfter", labelKey: "emotionAfter", multi: false, order: "alpha" },
  { key: "tag", labelKey: "tag", multi: true, order: "alpha" },
  { key: "mistake", labelKey: "mistake", multi: true, order: "alpha" },
  { key: "holdingTimeBucket", labelKey: "holdingTimeBucket", multi: false, order: "rank", ranks: Object.fromEntries(HOLDING_BUCKETS.map((b) => [b.key, b.rank])) },
  { key: "lotSizeBucket", labelKey: "lotSizeBucket", multi: false, order: "rank", ranks: Object.fromEntries(LOT_BUCKETS.map((b) => [b.key, b.rank])) },
  { key: "riskPercentBucket", labelKey: "riskPercentBucket", multi: false, order: "rank", ranks: Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, b.rank])) },
  { key: "confidence", labelKey: "confidence", multi: false, order: "rank", ranks: { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 }, domain: ["1", "2", "3", "4", "5"] },
  { key: "setupQuality", labelKey: "setupQuality", multi: false, order: "rank", ranks: { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 }, domain: ["1", "2", "3", "4", "5"] },
  { key: "followedPlan", labelKey: "followedPlan", multi: false, order: "rank", ranks: { yes: 1, no: 2 }, domain: ["yes", "no"] },
  { key: "exitReason", labelKey: "exitReason", multi: false, order: "rank", ranks: { TP_HIT: 1, SL_HIT: 2, MANUAL: 3, TRAILING: 4, TIME: 5, BREAKEVEN_STOP: 6, PARTIAL: 7, OTHER: 8 } },
  { key: "result", labelKey: "result", multi: false, order: "rank", ranks: { WIN: 1, LOSS: 2, BREAKEVEN: 3 }, domain: ["WIN", "LOSS", "BREAKEVEN"] },
  { key: "account", labelKey: "account", multi: false, order: "alpha" },
  { key: "tradeIndex", labelKey: "tradeIndex", multi: false, order: "numeric" },
  { key: "date", labelKey: "date", multi: false, order: "chrono" },
];

export function dimensionDef(key: XDimension): DimensionDef {
  const def = X_DIMENSION_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown dimension: ${key}`);
  return def;
}

/** Category keys of one trade for a dimension — null/empty = excluded. */
export function categoriesOf(t: BuilderTrade, dim: XDimension): string[] {
  switch (dim) {
    case "hourOfDay":
      return t.localHour == null ? [] : [String(t.localHour)];
    case "dayOfWeek":
      return t.localWeekday == null ? [] : [WEEKDAY_KEYS[t.localWeekday - 1] ?? "?"];
    case "dayOfMonth":
      return t.localDayOfMonth == null ? [] : [String(t.localDayOfMonth)];
    case "month":
      return t.localMonth == null ? [] : [MONTH_KEYS[t.localMonth - 1] ?? "?"];
    case "week":
      return t.localIsoWeek == null ? [] : [String(t.localIsoWeek)];
    case "session":
      return t.session ? [t.session] : [];
    case "instrument":
      return [t.symbol];
    case "strategy":
      return t.strategyName ? [t.strategyName] : [];
    case "direction":
      return [t.direction];
    case "timeframe":
      return t.timeframe ? [t.timeframe] : [];
    case "setupType":
      return t.setupType ? [t.setupType] : [];
    case "marketCondition":
      return t.marketCondition ? [t.marketCondition] : [];
    case "emotionBefore":
      return t.emotionBefore ? [t.emotionBefore] : [];
    case "emotionDuring":
      return t.emotionDuring ? [t.emotionDuring] : [];
    case "emotionAfter":
      return t.emotionAfter ? [t.emotionAfter] : [];
    case "tag":
      return t.tags;
    case "mistake":
      return t.mistakes;
    case "holdingTimeBucket": {
      const b = holdingBucket(t.durationMin);
      return b ? [b] : [];
    }
    case "lotSizeBucket": {
      const b = lotBucket(t.lots);
      return b ? [b] : [];
    }
    case "riskPercentBucket": {
      const b = riskBucket(t.riskPercent);
      return b ? [b] : [];
    }
    case "confidence":
      return t.confidence == null ? [] : [String(t.confidence)];
    case "setupQuality":
      return t.setupQualityRating == null ? [] : [String(t.setupQualityRating)];
    case "followedPlan":
      return t.followedPlan == null ? [] : [t.followedPlan ? "yes" : "no"];
    case "exitReason":
      return t.exitReason ? [t.exitReason] : [];
    case "result":
      return t.resultType ? [t.resultType] : [];
    case "account":
      return [t.accountName];
    case "tradeIndex":
      return []; // scatter-only — handled separately
    case "date":
      return t.localEntryDate ? [t.localEntryDate] : [];
  }
}

// ── Measure registry ─────────────────────────────────────────────────────────

export interface MeasureDef {
  key: YMeasure;
  labelKey: string;
  /** perTrade: aggregation applies. aggregate: computed from the category stats. */
  kind: "perTrade" | "aggregate";
  /** Value format hint for the UI. */
  format: "R" | "CURRENCY" | "PIPS" | "POINTS" | "LOTS" | "PERCENT" | "NUMBER" | "DURATION";
  valueOf: (t: BuilderTrade) => Decimal | null;
}

export const Y_MEASURE_DEFS: MeasureDef[] = [
  { key: "rMultiple", labelKey: "rMultiple", kind: "perTrade", format: "R", valueOf: (t) => (t.rMultiple == null ? null : toD(t.rMultiple)) },
  { key: "netPnl", labelKey: "netPnl", kind: "perTrade", format: "CURRENCY", valueOf: (t) => (t.netPnl == null ? null : toD(t.netPnl)) },
  { key: "pips", labelKey: "pips", kind: "perTrade", format: "PIPS", valueOf: (t) => (t.pips == null ? null : toD(t.pips)) },
  { key: "points", labelKey: "points", kind: "perTrade", format: "POINTS", valueOf: (t) => (t.points == null ? null : toD(t.points)) },
  { key: "lots", labelKey: "lots", kind: "perTrade", format: "LOTS", valueOf: (t) => (t.lots == null ? null : toD(t.lots)) },
  { key: "riskPercent", labelKey: "riskPercent", kind: "perTrade", format: "PERCENT", valueOf: (t) => (t.riskPercent == null ? null : toD(t.riskPercent)) },
  { key: "mfeR", labelKey: "mfeR", kind: "perTrade", format: "R", valueOf: (t) => (t.mfeR == null ? null : toD(t.mfeR)) },
  { key: "maeR", labelKey: "maeR", kind: "perTrade", format: "R", valueOf: (t) => (t.maeR == null ? null : toD(t.maeR)) },
  { key: "winRate", labelKey: "winRate", kind: "aggregate", format: "PERCENT", valueOf: () => null },
  { key: "expectancy", labelKey: "expectancy", kind: "aggregate", format: "R", valueOf: () => null },
  { key: "profitFactor", labelKey: "profitFactor", kind: "aggregate", format: "NUMBER", valueOf: () => null },
  { key: "tradeCount", labelKey: "tradeCount", kind: "aggregate", format: "NUMBER", valueOf: () => null },
  { key: "avgHoldingTime", labelKey: "avgHoldingTime", kind: "aggregate", format: "DURATION", valueOf: () => null },
];

export function measureDef(key: YMeasure): MeasureDef {
  const def = Y_MEASURE_DEFS.find((m) => m.key === key);
  if (!def) throw new Error(`Unknown measure: ${key}`);
  return def;
}

/** Numeric X measures (scatter / histogram). */
export const NUMERIC_X_DEFS: Array<{
  key: NumericXMeasure;
  labelKey: string;
  valueOf: (t: BuilderTrade) => Decimal | null;
}> = [
  { key: "rMultiple", labelKey: "rMultiple", valueOf: (t) => (t.rMultiple == null ? null : toD(t.rMultiple)) },
  { key: "netPnl", labelKey: "netPnl", valueOf: (t) => (t.netPnl == null ? null : toD(t.netPnl)) },
  { key: "pips", labelKey: "pips", valueOf: (t) => (t.pips == null ? null : toD(t.pips)) },
  { key: "holdingTimeMin", labelKey: "holdingTimeMin", valueOf: (t) => (t.durationMin == null ? null : toD(t.durationMin)) },
  { key: "mfeR", labelKey: "mfeR", valueOf: (t) => (t.mfeR == null ? null : toD(t.mfeR)) },
  { key: "maeR", labelKey: "maeR", valueOf: (t) => (t.maeR == null ? null : toD(t.maeR)) },
  { key: "lots", labelKey: "lots", valueOf: (t) => (t.lots == null ? null : toD(t.lots)) },
  { key: "riskPercent", labelKey: "riskPercent", valueOf: (t) => (t.riskPercent == null ? null : toD(t.riskPercent)) },
];

// ── Aggregation math ─────────────────────────────────────────────────────────

/** Linear-interpolation percentile (numpy "linear" method), p in [0,100]. */
export function percentileOf(values: Decimal[], p: number): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.cmp(b));
  if (sorted.length === 1) return sorted[0];
  const rank = new Decimal(p).div(100).times(sorted.length - 1);
  const low = rank.floor().toNumber();
  const high = rank.ceil().toNumber();
  if (low === high) return sorted[low];
  const frac = rank.minus(low);
  return sorted[low].plus(sorted[high].minus(sorted[low]).times(frac));
}

function aggregateValues(
  values: Decimal[],
  aggregation: Aggregation,
  percentile?: number
): Decimal | null {
  if (values.length === 0) return null;
  switch (aggregation) {
    case "sum":
      return values.reduce((acc, v) => acc.plus(v), D0);
    case "avg":
      return values.reduce((acc, v) => acc.plus(v), D0).div(values.length);
    case "median":
      return percentileOf(values, 50);
    case "min":
      return values.reduce((m, v) => (v.lt(m) ? v : m));
    case "max":
      return values.reduce((m, v) => (v.gt(m) ? v : m));
    case "count":
      return new Decimal(values.length);
    case "percentile":
      return percentileOf(values, percentile ?? 50);
  }
}

/** Aggregate measure value from a category's trades (winRate, expectancy…). */
function aggregateMeasureOf(
  measure: YMeasure,
  trades: BuilderTrade[]
): Decimal | null {
  if (trades.length === 0) return null;
  switch (measure) {
    case "tradeCount":
      return new Decimal(trades.length);
    case "winRate": {
      const wins = trades.filter((t) => t.resultType === "WIN").length;
      return new Decimal(wins).div(trades.length).times(100);
    }
    case "expectancy": {
      const rs = trades
        .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
        .filter((r): r is Decimal => r !== null);
      if (rs.length === 0) return null;
      return rs.reduce((acc, r) => acc.plus(r), D0).div(rs.length);
    }
    case "profitFactor": {
      const pnls = trades.map((t) => toD(t.netPnl ?? 0));
      const gw = pnls.filter((p) => p.gt(0)).reduce((a, p) => a.plus(p), D0);
      const gl = pnls.filter((p) => p.lt(0)).reduce((a, p) => a.plus(p.abs()), D0);
      if (gl.isZero()) return null; // ∞ is not plottable → null
      return gw.div(gl);
    }
    case "avgHoldingTime": {
      const ds = trades
        .map((t) => (t.durationMin == null ? null : toD(t.durationMin)))
        .filter((d): d is Decimal => d !== null);
      if (ds.length === 0) return null;
      return ds.reduce((a, d) => a.plus(d), D0).div(ds.length);
    }
    default:
      return null;
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

const GROUP_KEYS: Record<Exclude<GroupBy, "none">, Array<{ key: string; labelKey: string }>> = {
  direction: [
    { key: "LONG", labelKey: "LONG" },
    { key: "SHORT", labelKey: "SHORT" },
  ],
  result: [
    { key: "WIN", labelKey: "WIN" },
    { key: "LOSS", labelKey: "LOSS" },
    { key: "BREAKEVEN", labelKey: "BREAKEVEN" },
  ],
  followedPlan: [
    { key: "yes", labelKey: "yes" },
    { key: "no", labelKey: "no" },
  ],
};

function groupKeys(t: BuilderTrade, groupBy: GroupBy): string[] {
  switch (groupBy) {
    case "direction":
      return [t.direction];
    case "result":
      return [t.resultType ?? "BREAKEVEN"];
    case "followedPlan":
      return t.followedPlan == null ? [] : [t.followedPlan ? "yes" : "no"];
    default:
      return ["all"];
  }
}

// ── Box plot ─────────────────────────────────────────────────────────────────

export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

export function boxStatsOf(values: number[]): BoxStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const d = percentileOf(sorted.map((v) => new Decimal(v)), p);
    return d ? d.toNumber() : sorted[0];
  };
  const q1 = q(25);
  const median = q(50);
  const q3 = q(75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= lowFence && v <= highFence);
  const outliers = sorted.filter((v) => v < lowFence || v > highFence);
  return {
    q1,
    median,
    q3,
    whiskerLow: inliers.length > 0 ? inliers[0] : median,
    whiskerHigh: inliers.length > 0 ? inliers[inliers.length - 1] : median,
    outliers,
  };
}

// ── Trend line (scatter) ─────────────────────────────────────────────────────

export interface TrendResult {
  slope: number;
  intercept: number;
  r2: number;
  /** Two endpoints for drawing. */
  from: [number, number];
  to: [number, number];
}

export function linearTrend(points: Array<[number, number]>): TrendResult | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const xs = points.map((p) => p[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return {
    slope,
    intercept,
    r2,
    from: [minX, slope * minX + intercept],
    to: [maxX, slope * maxX + intercept],
  };
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface ChartDatum {
  /** Display key (raw category — the UI localizes buckets/weekday names). */
  key: string;
  /** Series key → aggregated value (JS number for Recharts; null = no data). */
  values: Record<string, number | null>;
  /** Trades in this category (all groups). */
  n: number;
  /** Trade ids (capped — see TRADE_ID_CAP), for drill-down counts. */
  tradeIds: string[];
  /** True count of matching trades (≥ tradeIds.length when capped). */
  total: number;
  /** Below the configured minimum sample size. */
  lowSample: boolean;
  /** Box plot stats per series (chartType = box). */
  boxes?: Record<string, BoxStats | null>;
  /** Drill-down descriptor for the trades view. */
  drill: { dimension: XDimension; value: string };
}

export interface ScatterPoint {
  x: number;
  y: number;
  group: string;
  tradeId: string;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface ChartResult {
  ok: true;
  chartType: ChartType;
  /** Series actually present (groupBy series with ≥ 1 trade). */
  series: Array<{ key: string; labelKey: string }>;
  /** Categorical data rows (bar/line/area/box). */
  data: ChartDatum[];
  /** Scatter points (scatter). */
  points: ScatterPoint[];
  /** Trend line (scatter + showTrendLine). */
  trend: TrendResult | null;
  /** Histogram bins. */
  histogram: HistogramBin[];
  /** i18n message codes (chartsBuilder.warnings.*). */
  warnings: string[];
  /** Trades excluded because the dimension was null/missing. */
  excludedCount: number;
}

/** Max trade ids carried per datum (drill-down shows the true total anyway). */
export const TRADE_ID_CAP = 500;

// ── Errors ───────────────────────────────────────────────────────────────────

export class ChartConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartConfigError";
  }
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a chart from filtered closed trades. The config MUST already be
 * validated (chartConfigSchema) — invalid combos throw ChartConfigError.
 */
export function buildChart(
  trades: BuilderTrade[],
  config: ChartConfig
): ChartResult {
  const warnings: string[] = [];
  const ordered = [...trades].sort(
    (a, b) =>
      new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime() ||
      a.id.localeCompare(b.id)
  );

  if (config.chartType === "histogram") {
    return buildHistogram(ordered, config, warnings);
  }
  if (config.chartType === "scatter") {
    return buildScatter(ordered, config, warnings);
  }
  return buildCategorical(ordered, config, warnings);
}

function buildHistogram(
  trades: BuilderTrade[],
  config: ChartConfig,
  warnings: string[]
): ChartResult {
  const def = NUMERIC_X_DEFS.find((d) => d.key === config.x);
  if (!def) throw new ChartConfigError("histogramRequiresNumericX");
  const xs = trades
    .map((t) => def.valueOf(t))
    .filter((v): v is Decimal => v !== null);
  const excluded = trades.length - xs.length;
  if (excluded > 0) warnings.push("missingValuesExcluded");

  const empty: ChartResult = {
    ok: true,
    chartType: "histogram",
    series: [],
    data: [],
    points: [],
    trend: null,
    histogram: [],
    warnings,
    excludedCount: excluded,
  };
  if (xs.length === 0) return empty;

  const nums = xs.map((d) => d.toNumber());
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const binCount =
    config.binCount ?? Math.min(60, Math.max(5, Math.ceil(Math.log2(xs.length) + 1)));
  const width = (max - min) / binCount || 1;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of nums) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1; // max lands in the last bin
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return { ...empty, histogram: bins };
}

function buildScatter(
  trades: BuilderTrade[],
  config: ChartConfig,
  warnings: string[]
): ChartResult {
  if (config.y == null) throw new ChartConfigError("scatterRequiresY");
  const yDef = measureDef(config.y);
  if (yDef.kind !== "perTrade") {
    throw new ChartConfigError("scatterRequiresPerTradeY");
  }

  const xOf = (t: BuilderTrade): number | null => {
    if (config.x === "tradeIndex") {
      return trades.indexOf(t) + 1;
    }
    if (config.x === "date") {
      return t.localEntryDate
        ? new Date(`${t.localEntryDate}T00:00:00Z`).getTime()
        : null;
    }
    const def = NUMERIC_X_DEFS.find((d) => d.key === config.x);
    if (!def) return null;
    const v = def.valueOf(t);
    return v == null ? null : v.toNumber();
  };

  const points: ScatterPoint[] = [];
  let excluded = 0;
  for (const t of trades) {
    const x = xOf(t);
    const y = yDef.valueOf(t);
    if (x == null || y == null) {
      excluded += 1;
      continue;
    }
    for (const g of groupKeys(t, config.groupBy)) {
      points.push({ x, y: y.toNumber(), group: g, tradeId: t.id });
    }
  }
  if (excluded > 0) warnings.push("missingValuesExcluded");

  const trend = config.showTrendLine
    ? linearTrend(points.map((p) => [p.x, p.y] as [number, number]))
    : null;

  const series = activeSeries(config, points.map((p) => p.group));
  return {
    ok: true,
    chartType: "scatter",
    series,
    data: [],
    points,
    trend,
    histogram: [],
    warnings,
    excludedCount: excluded,
  };
}

function buildCategorical(
  trades: BuilderTrade[],
  config: ChartConfig,
  warnings: string[]
): ChartResult {
  if (config.y == null) throw new ChartConfigError("requiresY");
  const yDef = measureDef(config.y);
  if (config.chartType === "box" && yDef.kind !== "perTrade") {
    throw new ChartConfigError("boxRequiresPerTradeY");
  }
  const xDim = config.x as XDimension;
  const def = dimensionDef(xDim);

  // Bucket trades by category (fan-out on multi dimensions).
  const byCategory = new Map<string, BuilderTrade[]>();
  let excluded = 0;
  const indexBase = new Map<string, number>(); // tradeIndex numbering
  trades.forEach((t, i) => indexBase.set(t.id, i + 1));

  for (const t of trades) {
    const cats =
      xDim === "tradeIndex"
        ? [String(indexBase.get(t.id) ?? 0)]
        : categoriesOf(t, xDim);
    if (cats.length === 0) {
      excluded += 1;
      continue;
    }
    for (const c of cats) {
      const list = byCategory.get(c);
      if (list) list.push(t);
      else byCategory.set(c, [t]);
    }
  }
  if (excluded > 0) warnings.push("missingValuesExcluded");

  const series = groupSeriesList(config);

  // Aggregate per category × series.
  const data: ChartDatum[] = [];
  for (const [key, catTrades] of byCategory) {
    const values: Record<string, number | null> = {};
    const boxes: Record<string, BoxStats | null> = {};
    let present = false;
    for (const s of series) {
      const groupTrades = catTrades.filter((t) =>
        groupKeys(t, config.groupBy).includes(s.key)
      );
      if (config.chartType === "box") {
        const vals = groupTrades
          .map((t) => yDef.valueOf(t))
          .filter((v): v is Decimal => v !== null)
          .map((v) => v.toNumber());
        boxes[s.key] = boxStatsOf(vals);
        values[s.key] = boxes[s.key]?.median ?? null;
        if (vals.length > 0) present = true;
        continue;
      }
      if (yDef.kind === "aggregate") {
        const v = aggregateMeasureOf(config.y, groupTrades);
        values[s.key] = v == null ? null : v.toNumber();
        if (groupTrades.length > 0) present = true;
      } else {
        const vals = groupTrades
          .map((t) => yDef.valueOf(t))
          .filter((v): v is Decimal => v !== null);
        const v = aggregateValues(vals, config.aggregation ?? "sum", config.percentile);
        values[s.key] = v == null ? null : v.toNumber();
        if (vals.length > 0) present = true;
      }
    }
    if (!present) continue;

    const total = catTrades.length;
    data.push({
      key,
      values,
      n: total,
      tradeIds: catTrades.slice(0, TRADE_ID_CAP).map((t) => t.id),
      total,
      lowSample: config.minSampleSize > 0 && total < config.minSampleSize,
      ...(config.chartType === "box" ? { boxes } : {}),
      drill: { dimension: xDim, value: key },
    });
  }

  // Sorting.
  sortData(data, def, config);

  // Top-N (by max |value| across series) — re-sorted naturally afterwards.
  if (config.topN != null && data.length > config.topN) {
    const ranked = [...data].sort((a, b) => maxAbs(b) - maxAbs(a)).slice(0, config.topN);
    data.length = 0;
    data.push(...ranked);
    sortData(data, def, config);
    warnings.push("topNApplied");
  }

  const lowSampleCount = data.filter((d) => d.lowSample).length;
  if (lowSampleCount > 0) warnings.push("lowSampleCategories");

  return {
    ok: true,
    chartType: config.chartType,
    series: series.filter((s) =>
      data.some((d) => d.values[s.key] != null || d.boxes?.[s.key] != null)
    ),
    data,
    points: [],
    trend: null,
    histogram: [],
    warnings,
    excludedCount: excluded,
  };
}

function maxAbs(d: ChartDatum): number {
  let m = 0;
  for (const v of Object.values(d.values)) {
    if (v != null) m = Math.max(m, Math.abs(v));
  }
  return m;
}

function sortData(data: ChartDatum[], def: DimensionDef, config: ChartConfig): void {
  switch (config.sort) {
    case "valueDesc":
      data.sort((a, b) => maxAbs(b) - maxAbs(a));
      break;
    case "valueAsc":
      data.sort((a, b) => maxAbs(a) - maxAbs(b));
      break;
    case "keyAsc":
      data.sort((a, b) => a.key.localeCompare(b.key));
      break;
    case "keyDesc":
      data.sort((a, b) => b.key.localeCompare(a.key));
      break;
    case "natural":
    default:
      sortNatural(data, def);
      break;
  }
}

function sortNatural(data: ChartDatum[], def: DimensionDef): void {
  switch (def.order) {
    case "rank": {
      const ranks = def.ranks ?? {};
      data.sort(
        (a, b) =>
          (ranks[a.key] ?? 999) - (ranks[b.key] ?? 999) ||
          a.key.localeCompare(b.key)
      );
      break;
    }
    case "numeric":
      data.sort((a, b) => Number(a.key) - Number(b.key) || a.key.localeCompare(b.key));
      break;
    case "chrono":
      data.sort((a, b) => a.key.localeCompare(b.key));
      break;
    case "alpha":
    default:
      data.sort((a, b) => a.key.localeCompare(b.key));
      break;
  }
}

function groupSeriesList(config: ChartConfig): Array<{ key: string; labelKey: string }> {
  if (config.groupBy === "none") return [{ key: "all", labelKey: "all" }];
  return GROUP_KEYS[config.groupBy];
}

function activeSeries(
  config: ChartConfig,
  presentGroups: string[]
): Array<{ key: string; labelKey: string }> {
  const all = groupSeriesList(config);
  const present = new Set(presentGroups);
  return all.filter((s) => present.has(s.key));
}

// ── CSV export of the underlying data ────────────────────────────────────────

/** CSV of the result (underlying aggregates / points / bins). */
export function chartResultToCsv(result: ChartResult): string {
  const escape = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (result.chartType === "scatter") {
    const head = "x,y,group,tradeId";
    const rows = result.points.map((p) =>
      [p.x, p.y, p.group, p.tradeId].map(escape).join(",")
    );
    return [head, ...rows].join("\n");
  }
  if (result.chartType === "histogram") {
    const head = "binFrom,binTo,count";
    const rows = result.histogram.map((b) =>
      [b.from, b.to, b.count].map(escape).join(",")
    );
    return [head, ...rows].join("\n");
  }
  const seriesKeys = result.series.map((s) => s.key);
  const head = ["key", ...seriesKeys, "n"].map(escape).join(",");
  const rows = result.data.map((d) =>
    [d.key, ...seriesKeys.map((k) => d.values[k] ?? ""), d.total]
      .map(escape)
      .join(",")
  );
  return [head, ...rows].join("\n");
}

// ── Drill-down filter mapping ────────────────────────────────────────────────

/**
 * Map a drill-down descriptor to /api/trades list query filters. Dimensions
 * without a server-side filter (buckets, tags…) return {} — the UI shows a
 * notice that the drill-down opened unfiltered for those.
 */
export function drillToTradeFilters(
  dimension: XDimension,
  value: string
): Partial<{
  symbol: string;
  direction: string;
  session: string;
  timeframe: string;
  emotion: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  resultType: string;
  entryHour: number;
  entryWeekday: number;
}> {
  switch (dimension) {
    case "instrument":
      return { symbol: value };
    case "direction":
      return { direction: value };
    case "session":
      return { session: value };
    case "timeframe":
      return { timeframe: value };
    case "emotionBefore":
    case "emotionDuring":
    case "emotionAfter":
      return { emotion: value };
    case "setupType":
      return { search: value };
    case "result":
      return { resultType: value };
    case "hourOfDay":
      return { entryHour: Number(value) };
    case "dayOfWeek": {
      const idx = WEEKDAY_KEYS.indexOf(value);
      return { entryWeekday: idx + 1 };
    }
    case "date":
      return { dateFrom: `${value}T00:00:00.000Z`, dateTo: `${value}T23:59:59.999Z` };
    case "month":
    case "week":
    case "dayOfMonth":
    case "tag":
    case "mistake":
    case "holdingTimeBucket":
    case "lotSizeBucket":
    case "riskPercentBucket":
    case "confidence":
    case "setupQuality":
    case "followedPlan":
    case "exitReason":
    case "marketCondition":
    case "account":
    case "strategy":
    case "tradeIndex":
    default:
      return {};
  }
}

/** True when the dimension has a server-side drill-down filter. */
export function drillIsFilterable(dimension: XDimension): boolean {
  const f = drillToTradeFilters(dimension, "X");
  return Object.keys(f).length > 0;
}

// ── Convenience exports for the UI ───────────────────────────────────────────

export const WEEKDAY_KEY_LIST = WEEKDAY_KEYS;
export const MONTH_KEY_LIST = MONTH_KEYS;
export const HOLDING_BUCKET_KEYS = HOLDING_BUCKETS.map((b) => b.key);
export const LOT_BUCKET_KEYS = LOT_BUCKETS.map((b) => b.key);
export const RISK_BUCKET_KEYS = RISK_BUCKETS.map((b) => b.key);

/** computeTradeStats re-export — category stats for aggregate measures. */
export { computeTradeStats };
