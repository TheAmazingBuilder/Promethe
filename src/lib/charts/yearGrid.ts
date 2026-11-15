/**
 * TradeJournal — yearly contribution calendar grid (v2.5 Module 2, spec §4.6).
 *
 * PURE and client-safe: builds a GitHub-style year grid — weeks as columns,
 * weekdays as rows — from daily aggregates. Handles leap years, configurable
 * week start (locale), and dates before/after the year (greyed). Dates are
 * local calendar days (YYYY-MM-DD strings from the server, computed in the
 * user's timezone — DST days are plain calendar dates, unaffected).
 */

export interface YearDayStats {
  /** Local calendar day YYYY-MM-DD. */
  date: string;
  netPnl: number;
  totalR: number | null;
  tradeCount: number;
  wins: number;
  losses: number;
  hasJournal: boolean;
  /** Discipline score from the journal entry (1-10), null when absent. */
  discipline: number | null;
}

export interface YearCell {
  /** Local calendar day YYYY-MM-DD ("" for cells outside the year). */
  date: string;
  inYear: boolean;
  stats: YearDayStats | null;
  /** Grid coordinates (row 0-6 = week start + 6, col = week index 0-52). */
  row: number;
  col: number;
}

export interface YearGrid {
  year: number;
  /** 7 rows × N week columns (N = 52 or 53). */
  cells: YearCell[][];
  monthLabelCols: Array<{ col: number; month: number }>;
  /** ISO weekday of row 0 (1 = Monday, 7 = Sunday). */
  weekStart: 1 | 7;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date. */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

const DAY_MS = 86_400_000;
const dateToMs = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const msToDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/**
 * Build the year grid. `weekStart` 1 = Monday (ISO), 7 = Sunday (US) —
 * per locale. Days of adjacent years render as greyed cells so every week
 * column is complete.
 */
export function buildYearGrid(
  year: number,
  stats: Record<string, YearDayStats>,
  weekStart: 1 | 7 = 1
): YearGrid {
  const jan1 = `...`.slice(0, 0) + `${year}-01-01`;
  const jan1Ms = dateToMs(jan1);
  const jan1Iso = isoWeekdayOf(jan1);
  // Row of Jan 1 in the grid: (iso − weekStart + 7) % 7.
  const firstRow = (((jan1Iso - weekStart) % 7) + 7) % 7;

  // Grid starts up to 6 days before Jan 1 (the partial first week).
  const gridStartMs = jan1Ms - firstRow * DAY_MS;

  const daysInYear =
    (dateToMs(`${year + 1}-01-01`) - jan1Ms) / DAY_MS; // 365 or 366
  const totalCells = firstRow + daysInYear;
  const nWeeks = Math.ceil(totalCells / 7);

  const cells: YearCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: nWeeks }, () => ({
      date: "",
      inYear: false,
      stats: null,
      row: 0,
      col: 0,
    }))
  );

  for (let i = 0; i < nWeeks * 7; i += 1) {
    const row = i % 7;
    const col = Math.floor(i / 7);
    const ms = gridStartMs + i * DAY_MS;
    const date = msToDate(ms);
    const d = new Date(ms);
    const inYear = d.getUTCFullYear() === year;
    cells[row][col] = {
      date: inYear ? date : "",
      inYear,
      stats: inYear ? (stats[date] ?? null) : null,
      row,
      col,
    };
  }

  // Month labels: first week column of each month.
  const monthLabelCols: Array<{ col: number; month: number }> = [];
  let lastMonth = -1;
  for (let col = 0; col < nWeeks; col += 1) {
    // Find the first in-year cell of this column with a day ≤ 7 (label rows).
    for (let row = 0; row < 7; row += 1) {
      const cell = cells[row][col];
      if (!cell.inYear) continue;
      const month = Number(cell.date.slice(5, 7));
      if (month !== lastMonth) {
        monthLabelCols.push({ col, month });
        lastMonth = month;
      }
      break;
    }
  }

  return { year, cells, monthLabelCols, weekStart };
}

// ── Metrics per cell ─────────────────────────────────────────────────────────

export type YearMetric =
  | "netPnl"
  | "totalR"
  | "tradeCount"
  | "winLoss"
  | "journal"
  | "discipline";

export interface MetricScale {
  /** "diverging" (gain/loss around zero) | "sequential" (0 → max). */
  kind: "diverging" | "sequential" | "binary";
  /** Diverging: max |value| over the year; sequential: max value. */
  max: number | null;
}

export function metricScale(
  stats: Record<string, YearDayStats>,
  metric: YearMetric
): MetricScale {
  const values = Object.values(stats);
  if (values.length === 0) return { kind: metric === "netPnl" || metric === "totalR" ? "diverging" : "sequential", max: null };
  switch (metric) {
    case "netPnl":
    case "totalR": {
      let max = 0;
      for (const v of values) {
        const x = metric === "netPnl" ? v.netPnl : (v.totalR ?? 0);
        max = Math.max(max, Math.abs(x));
      }
      return { kind: "diverging", max: max > 0 ? max : null };
    }
    case "tradeCount": {
      let max = 0;
      for (const v of values) max = Math.max(max, v.tradeCount);
      return { kind: "sequential", max: max > 0 ? max : null };
    }
    case "discipline": {
      let max = 0;
      for (const v of values) max = Math.max(max, v.discipline ?? 0);
      return { kind: "sequential", max: max > 0 ? max : null };
    }
    case "winLoss":
    case "journal":
      return { kind: "binary", max: null };
  }
}

/** Cell intensity (0-1) + tone for the metric — tokens resolved by the UI. */
export function cellTone(
  stats: YearDayStats | null,
  metric: YearMetric,
  scale: MetricScale
): { tone: "gain" | "loss" | "neutral" | "muted"; intensity: number } {
  if (stats == null) return { tone: "muted", intensity: 0 };
  switch (metric) {
    case "netPnl": {
      if (stats.tradeCount === 0 && stats.netPnl === 0) {
        return { tone: "muted", intensity: 0 };
      }
      if (scale.max == null) return { tone: "neutral", intensity: 0 };
      const r = Math.min(1, Math.abs(stats.netPnl) / scale.max);
      return {
        tone: stats.netPnl >= 0 ? "gain" : "loss",
        intensity: 0.25 + 0.75 * Math.pow(r, 0.6),
      };
    }
    case "totalR": {
      if (stats.totalR == null) return { tone: "muted", intensity: 0 };
      if (scale.max == null) return { tone: "neutral", intensity: 0 };
      const r = Math.min(1, Math.abs(stats.totalR) / scale.max);
      return {
        tone: stats.totalR >= 0 ? "gain" : "loss",
        intensity: 0.25 + 0.75 * Math.pow(r, 0.6),
      };
    }
    case "tradeCount": {
      if (stats.tradeCount === 0) return { tone: "muted", intensity: 0 };
      if (scale.max == null) return { tone: "neutral", intensity: 0 };
      const r = Math.min(1, stats.tradeCount / scale.max);
      return { tone: "gain", intensity: 0.25 + 0.75 * Math.pow(r, 0.6) };
    }
    case "winLoss": {
      if (stats.tradeCount === 0) return { tone: "muted", intensity: 0 };
      if (stats.wins > stats.losses) return { tone: "gain", intensity: 0.7 };
      if (stats.losses > stats.wins) return { tone: "loss", intensity: 0.7 };
      return { tone: "neutral", intensity: 0.5 };
    }
    case "journal": {
      return stats.hasJournal
        ? { tone: "gain", intensity: 0.6 }
        : { tone: "muted", intensity: 0 };
    }
    case "discipline": {
      if (stats.discipline == null) return { tone: "muted", intensity: 0 };
      if (scale.max == null) return { tone: "neutral", intensity: 0 };
      const r = Math.min(1, stats.discipline / scale.max);
      return { tone: "gain", intensity: 0.25 + 0.75 * r };
    }
  }
}
