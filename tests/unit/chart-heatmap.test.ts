/**
 * v2.5 Module 2 — cross-heatmap engine unit tests (spec §4.4, §7).
 *
 * Covers: empty matrix, single trade, sparse cells, multi-value fan-out,
 * timezone-correct hour bucketing (localHour from the server mapping),
 * min-sample exclusion from the color scale, natural vs performance
 * ordering, totals, metric math, cellColor diverging scale, CSV export.
 */
import { describe, expect, it } from "vitest";
import {
  buildMatrix,
  cellColor,
  matrixToCsv,
  type HeatmapMetric,
} from "@/lib/charts/heatmap";
import type { BuilderTrade } from "@/lib/charts/builder";

let seq = 0;
function trade(partial: Partial<BuilderTrade> = {}): BuilderTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    entryTime: `2025-01-1${seq % 10}T10:00:00.000Z`,
    exitTime: `2025-01-1${seq % 10}T12:00:00.000Z`,
    netPnl: "100",
    rMultiple: "1",
    resultType: "WIN",
    strategyId: null,
    strategyName: null,
    instrumentId: "i1",
    symbol: "EURUSD",
    direction: "LONG",
    session: "LONDON",
    lots: "1",
    accountId: "a1",
    accountName: "Main",
    timeframe: "M15",
    setupType: "breakout",
    marketCondition: "TRENDING",
    exitReason: "TP_HIT",
    emotionBefore: "CALM",
    emotionDuring: null,
    emotionAfter: null,
    confidence: 4,
    setupQualityRating: 4,
    followedPlan: true,
    pips: "20",
    points: "200",
    riskPercent: "1",
    mfeR: "2",
    maeR: "0.5",
    durationMin: 120,
    tags: [],
    mistakes: [],
    localDate: "2025-01-15",
    localEntryDate: "2025-01-15",
    localWeekday: 3,
    localHour: 10,
    localMonth: 1,
    localDayOfMonth: 15,
    localIsoWeek: 3,
    ...partial,
  };
}

describe("heatmap — buildMatrix basics", () => {
  it("empty trades produce an empty but valid matrix", () => {
    const m = buildMatrix([], "dayOfWeek", "hourOfDay", "expectancyR");
    expect(m.ok).toBe(true);
    expect(m.rows).toHaveLength(0);
    expect(m.colKeys).toHaveLength(0);
    expect(m.grand.n).toBe(0);
    expect(m.maxAbs).toBeNull();
  });

  it("single trade produces one cell with n=1 (low sample by default)", () => {
    const m = buildMatrix(
      [trade({ localHour: 14 })],
      "dayOfWeek",
      "hourOfDay",
      "expectancyR"
    );
    expect(m.rows).toHaveLength(1); // Wed
    expect(m.colKeys).toEqual(["14"]);
    const cell = m.rows[0].cells[0];
    expect(cell.n).toBe(1);
    expect(cell.value).toBe(1);
    expect(cell.lowSample).toBe(true); // default min 5
    expect(m.maxAbs).toBeNull(); // valid-cell scale excludes the low-sample cell
  });

  it("hour bucketing uses the timezone-aware localHour (not UTC)", () => {
    // Entry at 23:30 UTC = 18:30 America/Toronto (EST, UTC-5) — the server
    // maps localHour=18; the matrix must bucket on 18.
    const m = buildMatrix(
      [trade({ localHour: 18 })],
      "session",
      "hourOfDay",
      "tradeCount"
    );
    expect(m.colKeys).toEqual(["18"]);
  });

  it("multi-value tag dimension fans out across columns", () => {
    const trades = [
      trade({ tags: ["news", "london"] }),
      trade({ tags: ["news"] }),
    ];
    const m = buildMatrix(trades, "dayOfWeek", "tag", "tradeCount");
    expect(m.colKeys.sort()).toEqual(["london", "news"]);
    const news = m.rows[0].cells.find((c) => c.colKey === "news");
    const london = m.rows[0].cells.find((c) => c.colKey === "london");
    expect(news?.n).toBe(2);
    expect(london?.n).toBe(1);
    // Grand n counts trades (not fan-out occurrences).
    expect(m.grand.n).toBe(2);
  });

  it("trades missing either dimension are excluded and counted", () => {
    const m = buildMatrix(
      [trade({ session: null }), trade({ session: "LONDON" })],
      "session",
      "hourOfDay",
      "tradeCount"
    );
    expect(m.excludedCount).toBe(1);
    expect(m.warnings).toContain("missingValuesExcluded");
  });
});

describe("heatmap — metrics", () => {
  const trades = [
    trade({ netPnl: "100", rMultiple: "2", resultType: "WIN" }),
    trade({ netPnl: "-50", rMultiple: "-1", resultType: "LOSS" }),
    trade({ netPnl: "150", rMultiple: "3", resultType: "WIN" }),
  ];

  const metricValue = (metric: HeatmapMetric): number | null =>
    buildMatrix(trades, "direction", "session", metric).rows[0].cells[0].value;

  it("computes each metric correctly", () => {
    expect(metricValue("tradeCount")).toBe(3);
    expect(metricValue("netPnl")).toBe(200);
    expect(metricValue("winRate")).toBeCloseTo((2 / 3) * 100, 8);
    expect(metricValue("expectancyR")).toBeCloseTo((2 - 1 + 3) / 3, 8);
    expect(metricValue("avgR")).toBeCloseTo((2 - 1 + 3) / 3, 8);
    expect(metricValue("profitFactor")).toBeCloseTo(250 / 50, 8);
  });

  it("profitFactor null without losses (∞ not plottable)", () => {
    const m = buildMatrix(
      [trade({ netPnl: "10" }), trade({ netPnl: "20" })],
      "direction",
      "session",
      "profitFactor"
    );
    expect(m.rows[0].cells[0].value).toBeNull();
  });
});

describe("heatmap — min sample size and color scale", () => {
  it("low-sample cells are flagged, warned and excluded from maxAbs", () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      trade({ localHour: 10, netPnl: String(i), rMultiple: String(i) })
    );
    const few = Array.from({ length: 4 }, () => trade({ localHour: 22 }));
    const m = buildMatrix([...trades, ...few], "dayOfWeek", "hourOfDay", "netPnl", {
      minSampleSize: 5,
    });
    const h10 = m.rows[0].cells.find((c) => c.colKey === "10");
    const h22 = m.rows[0].cells.find((c) => c.colKey === "22");
    expect(h10?.lowSample).toBe(false);
    expect(h22?.lowSample).toBe(true);
    expect(m.warnings).toContain("lowSampleCells");
    // maxAbs from valid cells only: netPnl of hour 10 = 0+1+…+7 = 28
    expect(m.maxAbs).toBe(28);
    // Color: valid positive cell gets gain; low-sample gets neutral.
    expect(cellColor(h10!.value, m.maxAbs, h10!.lowSample).token).toBe("gain");
    expect(cellColor(h22!.value, m.maxAbs, h22!.lowSample)).toEqual({
      token: "neutral",
      intensity: 0,
    });
  });

  it("cellColor diverges around zero with compressed intensity", () => {
    expect(cellColor(-5, 10, false)).toEqual({
      token: "loss",
      intensity: 0.25 + 0.75 * Math.pow(0.5, 0.7),
    });
    expect(cellColor(10, 10, false).intensity).toBeCloseTo(1, 8);
    expect(cellColor(0, 10, false).intensity).toBeCloseTo(0.25, 8);
    expect(cellColor(99, 10, false).intensity).toBeCloseTo(1, 8); // clamped
    expect(cellColor(null, 10, false).token).toBe("neutral");
    expect(cellColor(5, null, false).token).toBe("neutral");
    expect(cellColor(5, 0, false).token).toBe("neutral");
  });
});

describe("heatmap — ordering and totals", () => {
  it("natural order uses the dimension ranks (weekdays Mon→Sun, hours numeric)", () => {
    const trades = [
      trade({ localWeekday: 5, localHour: 23 }),
      trade({ localWeekday: 1, localHour: 3 }),
      trade({ localWeekday: 3, localHour: 12 }),
    ];
    const m = buildMatrix(trades, "dayOfWeek", "hourOfDay", "tradeCount");
    expect(m.rows.map((r) => r.key)).toEqual(["Mon", "Wed", "Fri"]);
    expect(m.colKeys).toEqual(["3", "12", "23"]);
  });

  it("performance order sorts rows by metric descending", () => {
    const trades = [
      ...Array.from({ length: 6 }, () =>
        trade({ localWeekday: 2, netPnl: "50", rMultiple: "1" })
      ),
      ...Array.from({ length: 6 }, () =>
        trade({ localWeekday: 4, netPnl: "-20", rMultiple: "-0.5" })
      ),
    ];
    const m = buildMatrix(trades, "dayOfWeek", "session", "netPnl", {
      order: "performance",
    });
    expect(m.rows.map((r) => r.key)).toEqual(["Tue", "Thu"]);
  });

  it("totals aggregate over rows/columns", () => {
    const trades = [
      trade({ localWeekday: 1, localHour: 10, netPnl: "100" }),
      trade({ localWeekday: 1, localHour: 11, netPnl: "-40" }),
      trade({ localWeekday: 2, localHour: 10, netPnl: "60" }),
    ];
    const m = buildMatrix(trades, "dayOfWeek", "hourOfDay", "netPnl", {
      minSampleSize: 0,
    });
    const mon = m.rows.find((r) => r.key === "Mon");
    expect(mon?.total).toBe(60);
    expect(mon?.totalN).toBe(2);
    const h10 = m.colKeys.indexOf("10");
    expect(m.colTotals[h10]).toBe(160);
    expect(m.colTotalsN[h10]).toBe(2);
    expect(m.grand.value).toBe(120);
    expect(m.grand.n).toBe(3);
  });
});

describe("heatmap — CSV export", () => {
  it("row, per-column, total and n columns", () => {
    const m = buildMatrix(
      [trade({ localHour: 10, netPnl: "100" }), trade({ localHour: 11 })],
      "dayOfWeek",
      "hourOfDay",
      "netPnl",
      { minSampleSize: 0 }
    );
    const csv = matrixToCsv(m);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("row,10,11,total,n");
    expect(lines[1]).toContain("Wed");
    expect(lines[1]).toContain("100");
  });
});

describe("heatmap — sparse cells", () => {
  it("missing combinations render as n=0 / value null cells", () => {
    const m = buildMatrix(
      [trade({ localWeekday: 1, localHour: 10 }), trade({ localWeekday: 2, localHour: 11 })],
      "dayOfWeek",
      "hourOfDay",
      "tradeCount"
    );
    // Both rows and both columns exist; Mon × 11h is a sparse intersection.
    expect(m.rows.map((r) => r.key)).toEqual(["Mon", "Tue"]);
    expect(m.colKeys).toEqual(["10", "11"]);
    const mon = m.rows.find((r) => r.key === "Mon");
    expect(mon?.cells.find((c) => c.colKey === "10")?.n).toBe(1);
    expect(mon?.cells.find((c) => c.colKey === "11")?.n).toBe(0);
    expect(mon?.cells.find((c) => c.colKey === "11")?.value).toBeNull();
  });
});
