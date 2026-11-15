/**
 * v2.5 Module 2 — yearly grid unit tests (spec §4.6, §7).
 *
 * Covers: leap years, week-start variations (Monday/Sunday), greyed cells of
 * adjacent years, month labels, metric scales (diverging/sequential/binary),
 * cell tones (gain/loss intensity, muted empty days).
 */
import { describe, expect, it } from "vitest";
import {
  buildYearGrid,
  cellTone,
  isoWeekdayOf,
  metricScale,
  type YearDayStats,
} from "@/lib/charts/yearGrid";

const day = (date: string, patch: Partial<YearDayStats> = {}): YearDayStats => ({
  date,
  netPnl: 0,
  totalR: null,
  tradeCount: 0,
  wins: 0,
  losses: 0,
  hasJournal: false,
  discipline: null,
  ...patch,
});

const toRecord = (days: YearDayStats[]): Record<string, YearDayStats> =>
  Object.fromEntries(days.map((d) => [d.date, d]));

describe("yearGrid — structure", () => {
  it("2024 (leap year, Monday start) has 366 in-year cells across 53 weeks", () => {
    const grid = buildYearGrid(2024, {}, 1);
    const inYear = grid.cells.flat().filter((c) => c.inYear);
    expect(inYear).toHaveLength(366);
    expect(grid.cells).toHaveLength(7);
    expect(grid.cells[0].length).toBe(53); // ceil(366/7)
    // Jan 1 2024 is a Monday → row 0 of week 0.
    expect(grid.cells[0][0].date).toBe("2024-01-01");
    // Dec 31 2024 is a Tuesday → week 52, row 1 (row-major flat order ends
    // with the last Sunday, so assert by coordinates).
    expect(grid.cells[1][52].date).toBe("2024-12-31");
    expect(grid.cells[0][52].date).toBe("2024-12-30");
  });

  it("2023 (365 days, Sunday start) aligns Jan 1 to row 0", () => {
    const grid = buildYearGrid(2023, {}, 7);
    expect(grid.cells[0][0].date).toBe("2023-01-01"); // Jan 1 2023 = Sunday
    const inYear = grid.cells.flat().filter((c) => c.inYear);
    expect(inYear).toHaveLength(365);
  });

  it("cells outside the year are greyed but present (complete weeks)", () => {
    // 2023 starts on Sunday: with Monday start, week 0 has 6 greyed days
    // (rows 0-5) and Jan 1 sits on row 6.
    const grid = buildYearGrid(2023, {}, 1);
    const week0 = grid.cells.map((row) => row[0]);
    expect(week0.filter((c) => c.inYear)).toHaveLength(1); // only Jan 1
    expect(week0.filter((c) => !c.inYear)).toHaveLength(6);
    expect(week0[6].date).toBe("2023-01-01");
    // Every in-year cell has a date and stats slot.
    for (const cell of grid.cells.flat()) {
      if (cell.inYear) expect(cell.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(cell.date).toBe("");
    }
  });

  it("month labels land on the first week column of each month", () => {
    const grid = buildYearGrid(2025, {}, 1);
    expect(grid.monthLabelCols).toHaveLength(12);
    expect(grid.monthLabelCols[0]).toMatchObject({ month: 1 });
    expect(grid.monthLabelCols[11]).toMatchObject({ month: 12 });
    // Label columns are strictly increasing.
    const cols = grid.monthLabelCols.map((m) => m.col);
    expect([...cols].sort((a, b) => a - b)).toEqual(cols);
  });

  it("DST days are plain calendar dates (Mar 9 2025 exists once)", () => {
    const stats = toRecord([day("2025-03-09", { netPnl: 50, tradeCount: 1, wins: 1 })]);
    const grid = buildYearGrid(2025, stats, 1);
    const cell = grid.cells.flat().find((c) => c.date === "2025-03-09");
    expect(cell).toBeDefined();
    expect(cell?.stats?.netPnl).toBe(50);
    const all = grid.cells.flat().filter((c) => c.date === "2025-03-09");
    expect(all).toHaveLength(1);
  });

  it("isoWeekdayOf: Monday=1, Sunday=7", () => {
    expect(isoWeekdayOf("2024-01-01")).toBe(1); // Monday
    expect(isoWeekdayOf("2024-01-07")).toBe(7); // Sunday
    expect(isoWeekdayOf("2025-03-09")).toBe(7); // Sunday (DST day)
  });
});

describe("yearGrid — metrics", () => {
  const stats = toRecord([
    day("2025-01-02", { netPnl: 100, totalR: 2, tradeCount: 3, wins: 3, losses: 0 }),
    day("2025-01-03", { netPnl: -50, totalR: -1, tradeCount: 2, wins: 0, losses: 2 }),
    day("2025-01-06", { netPnl: 10, totalR: 0.2, tradeCount: 1, wins: 1, losses: 0, hasJournal: true, discipline: 8 }),
  ]);

  it("diverging scale for netPnl / totalR with max |value|", () => {
    const pnl = metricScale(stats, "netPnl");
    expect(pnl.kind).toBe("diverging");
    expect(pnl.max).toBe(100);
    const r = metricScale(stats, "totalR");
    expect(r.max).toBe(2);
  });

  it("sequential scale for tradeCount / discipline", () => {
    expect(metricScale(stats, "tradeCount")).toEqual({ kind: "sequential", max: 3 });
    expect(metricScale(stats, "discipline")).toEqual({ kind: "sequential", max: 8 });
  });

  it("binary scale for winLoss / journal", () => {
    expect(metricScale(stats, "winLoss").kind).toBe("binary");
    expect(metricScale(stats, "journal").kind).toBe("binary");
  });

  it("cell tones: gain/loss intensities, muted empty days", () => {
    const scale = metricScale(stats, "netPnl");
    const win = cellTone(stats["2025-01-02"], "netPnl", scale);
    expect(win.tone).toBe("gain");
    expect(win.intensity).toBeCloseTo(1, 4); // |100| = max → 0.25 + 0.75
    const loss = cellTone(stats["2025-01-03"], "netPnl", scale);
    expect(loss.tone).toBe("loss");
    expect(loss.intensity).toBeCloseTo(0.25 + 0.75 * Math.pow(0.5, 0.6), 4);
    const small = cellTone(stats["2025-01-06"], "netPnl", scale);
    expect(small.tone).toBe("gain");
    expect(small.intensity).toBeGreaterThan(0.25);
    expect(small.intensity).toBeLessThan(loss.intensity!);
    const empty = cellTone(null, "netPnl", scale);
    expect(empty.tone).toBe("muted");
    const noTrade = cellTone(day("2025-01-07"), "netPnl", scale);
    expect(noTrade.tone).toBe("muted");
  });

  it("winLoss tones and journal binary", () => {
    const bs = metricScale(stats, "winLoss");
    expect(cellTone(stats["2025-01-02"], "winLoss", bs).tone).toBe("gain");
    expect(cellTone(stats["2025-01-03"], "winLoss", bs).tone).toBe("loss");
    const js = metricScale(stats, "journal");
    expect(cellTone(stats["2025-01-06"], "journal", js)).toEqual({ tone: "gain", intensity: 0.6 });
    expect(cellTone(stats["2025-01-02"], "journal", js).tone).toBe("muted");
  });
});
