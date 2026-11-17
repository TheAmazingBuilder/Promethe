/**
 * TradeJournal — cross-heatmap engine (v2.5 Module 2, spec §4.4).
 *
 * PURE and client-safe: buildMatrix(trades, rowDim, colDim, metric) buckets
 * CLOSED trades over two dimensions (reusing the builder's category logic,
 * including multi-value fan-out for tags/mistakes) and computes one metric
 * per cell with sample sizes. Cells below the minimum sample size are flagged
 * and EXCLUDED from the color scale (they render hatched/greyed).
 *
 * Money/R math through decimal.js; only final display values become numbers.
 */
import { D0, Decimal, toD } from "@/lib/trading/dec";
import {
  categoriesOf,
  dimensionDef,
  type BuilderTrade,
} from "@/lib/charts/builder";
import type { XDimension } from "@/lib/validations/charts";

// ── Types ────────────────────────────────────────────────────────────────────

export const HEATMAP_METRICS = [
  "expectancyR",
  "netPnl",
  "winRate",
  "profitFactor",
  "tradeCount",
  "avgR",
] as const;
export type HeatmapMetric = (typeof HEATMAP_METRICS)[number];

/** Cell ordering. */
export type HeatmapOrder = "natural" | "performance";

export interface MatrixCell {
  rowKey: string;
  colKey: string;
  /** Metric value (null when no trades or not computable). */
  value: number | null;
  /** Trades in the cell (≥ minSampleSize = valid for the color scale). */
  n: number;
  lowSample: boolean;
  /** Wins/losses for the confidence hint. */
  wins: number;
  losses: number;
  /** Trade ids (capped) for drill-down display. */
  tradeIds: string[];
}

export interface MatrixRow {
  key: string;
  cells: MatrixCell[];
  /** Row aggregate (same metric over all row trades). */
  total: number | null;
  totalN: number;
}

export interface MatrixResult {
  ok: true;
  rowDim: XDimension;
  colDim: XDimension;
  metric: HeatmapMetric;
  rows: MatrixRow[];
  colKeys: string[];
  /** Column aggregates (same metric over all column trades). */
  colTotals: Array<number | null>;
  colTotalsN: number[];
  /** Grand totals. */
  grand: { value: number | null; n: number };
  /** Max |value| over VALID cells (color scale bound) - null when no data. */
  maxAbs: number | null;
  excludedCount: number;
  warnings: string[];
}

/** Max trade ids per cell (drill-down shows the true count anyway). */
export const MATRIX_TRADE_ID_CAP = 300;

// ── Metric computation ───────────────────────────────────────────────────────

function metricOf(metric: HeatmapMetric, trades: BuilderTrade[]): number | null {
  if (trades.length === 0) return null;
  switch (metric) {
    case "tradeCount":
      return trades.length;
    case "netPnl":
      return trades.reduce((acc, t) => acc.plus(toD(t.netPnl ?? 0)), D0).toNumber();
    case "winRate": {
      const wins = trades.filter((t) => t.resultType === "WIN").length;
      return (wins / trades.length) * 100;
    }
    case "expectancyR":
    case "avgR": {
      const rs = trades
        .map((t) => (t.rMultiple == null ? null : toD(t.rMultiple)))
        .filter((r): r is Decimal => r !== null);
      if (rs.length === 0) return null;
      return rs.reduce((a, r) => a.plus(r), D0).div(rs.length).toNumber();
    }
    case "profitFactor": {
      const pnls = trades.map((t) => toD(t.netPnl ?? 0));
      const gw = pnls.filter((p) => p.gt(0)).reduce((a, p) => a.plus(p), D0);
      const gl = pnls.filter((p) => p.lt(0)).reduce((a, p) => a.plus(p.abs()), D0);
      if (gl.isZero()) return null; // ∞ not plottable
      return gw.div(gl).toNumber();
    }
  }
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a row × col matrix of `metric` over the two dimensions. Trades with a
 * missing dimension value are excluded (counted in excludedCount).
 */
export function buildMatrix(
  trades: BuilderTrade[],
  rowDim: XDimension,
  colDim: XDimension,
  metric: HeatmapMetric,
  options?: { minSampleSize?: number; order?: HeatmapOrder }
): MatrixResult {
  const minSample = options?.minSampleSize ?? 5;
  const order = options?.order ?? "natural";
  const warnings: string[] = [];

  // Bucket trades per row/col key (fan-out on multi dimensions).
  const rowMap = new Map<string, BuilderTrade[]>();
  const colMap = new Map<string, BuilderTrade[]>();
  const cellMap = new Map<string, BuilderTrade[]>();
  let excluded = 0;

  for (const t of trades) {
    const rks = categoriesOf(t, rowDim);
    const cks = categoriesOf(t, colDim);
    if (rks.length === 0 || cks.length === 0) {
      excluded += 1;
      continue;
    }
    for (const rk of rks) {
      const list = rowMap.get(rk);
      if (list) list.push(t);
      else rowMap.set(rk, [t]);
    }
    for (const ck of cks) {
      const list = colMap.get(ck);
      if (list) list.push(t);
      else colMap.set(ck, [t]);
    }
    for (const rk of rks) {
      for (const ck of cks) {
        const key = `${rk}\u0000${ck}`;
        const list = cellMap.get(key);
        if (list) list.push(t);
        else cellMap.set(key, [t]);
      }
    }
  }
  if (excluded > 0) warnings.push("missingValuesExcluded");

  // Key ordering.
  const rowKeys = orderKeys([...rowMap.keys()], rowDim, order, rowMap, metric);
  const colKeys = orderKeys([...colMap.keys()], colDim, order, colMap, metric);

  // Cells.
  const rows: MatrixRow[] = rowKeys.map((rk) => {
    const cells = colKeys.map((ck) => {
      const cellTrades = cellMap.get(`${rk}\u0000${ck}`) ?? [];
      const wins = cellTrades.filter((t) => t.resultType === "WIN").length;
      const losses = cellTrades.filter((t) => t.resultType === "LOSS").length;
      return {
        rowKey: rk,
        colKey: ck,
        value: metricOf(metric, cellTrades),
        n: cellTrades.length,
        lowSample: cellTrades.length < minSample,
        wins,
        losses,
        tradeIds: cellTrades.slice(0, MATRIX_TRADE_ID_CAP).map((t) => t.id),
      };
    });
    const rowTrades = rowMap.get(rk) ?? [];
    return {
      key: rk,
      cells,
      total: metricOf(metric, rowTrades),
      totalN: rowTrades.length,
    };
  });

  const colTotals = colKeys.map((ck) => metricOf(metric, colMap.get(ck) ?? []));
  const colTotalsN = colKeys.map((ck) => (colMap.get(ck) ?? []).length);
  const grandValue = metricOf(metric, trades);
  const grandN = trades.length - excluded;

  // Color scale bound: max |value| over VALID cells only.
  let maxAbs: number | null = null;
  for (const row of rows) {
    for (const c of row.cells) {
      if (c.lowSample || c.value == null) continue;
      const a = Math.abs(c.value);
      if (maxAbs == null || a > maxAbs) maxAbs = a;
    }
  }

  if (rows.some((r) => r.cells.some((c) => c.lowSample && c.n > 0))) {
    warnings.push("lowSampleCells");
  }

  return {
    ok: true,
    rowDim,
    colDim,
    metric,
    rows,
    colKeys,
    colTotals,
    colTotalsN,
    grand: { value: grandValue, n: grandN },
    maxAbs,
    excludedCount: excluded,
    warnings,
  };
}

function orderKeys(
  keys: string[],
  dim: XDimension,
  order: HeatmapOrder,
  map: Map<string, BuilderTrade[]>,
  metric: HeatmapMetric
): string[] {
  if (order === "performance") {
    return [...keys].sort((a, b) => {
      const va = metricOf(metric, map.get(a) ?? []);
      const vb = metricOf(metric, map.get(b) ?? []);
      const na = map.get(a)?.length ?? 0;
      const nb = map.get(b)?.length ?? 0;
      // Performance: metric desc, trade count breaks ties.
      if (va == null && vb == null) return nb - na;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va === vb) return nb - na;
      return vb - va;
    });
  }
  // Natural: the dimension's own ordering.
  const def = dimensionDef(dim);
  switch (def.order) {
    case "rank": {
      const ranks = def.ranks ?? {};
      return keys.sort(
        (a, b) => (ranks[a] ?? 999) - (ranks[b] ?? 999) || a.localeCompare(b)
      );
    }
    case "numeric":
      return keys.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    case "chrono":
      return keys.sort((a, b) => a.localeCompare(b));
    default:
      return keys.sort((a, b) => a.localeCompare(b));
  }
}

// ── Color scale (pure value → intensity, token names resolved by the UI) ─────

/**
 * Diverging scale centered on ZERO: returns { token: "gain"|"loss"|"neutral",
 * intensity: 0-1 } — the UI mixes the CSS token with the card background.
 * Cells without a valid value or below the sample minimum → neutral/0
 * (rendered hatched by the component).
 */
export function cellColor(
  value: number | null,
  maxAbs: number | null,
  lowSample: boolean
): { token: "gain" | "loss" | "neutral"; intensity: number } {
  if (value == null || maxAbs == null || maxAbs === 0 || lowSample) {
    return { token: "neutral", intensity: 0 };
  }
  const ratio = Math.min(1, Math.abs(value) / maxAbs);
  // Compress so mid-range values stay readable: 0.25 + 0.75·ratio^0.7.
  const intensity = 0.25 + 0.75 * Math.pow(ratio, 0.7);
  return { token: value >= 0 ? "gain" : "loss", intensity };
}

// ── CSV export ───────────────────────────────────────────────────────────────

export function matrixToCsv(result: MatrixResult): string {
  const escape = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["row", ...result.colKeys, "total", "n"].map(escape).join(",");
  const rows = result.rows.map((r) =>
    [
      r.key,
      ...r.cells.map((c) => (c.value == null ? "" : c.value)),
      r.total == null ? "" : r.total,
      r.totalN,
    ]
      .map(escape)
      .join(",")
  );
  return [head, ...rows].join("\n");
}
