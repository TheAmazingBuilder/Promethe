/**
 * v2.5 Module 2 — chart builder engine unit tests (spec §7).
 *
 * Covers: aggregations (sum/avg/median/percentile/count), bucket edges,
 * dimension fan-out (tags/mistakes), group-by series, aggregate measures
 * (winRate/expectancy/profitFactor/tradeCount/avgHoldingTime), invalid combos
 * (schema-level), box stats, trend line + R², histogram binning, top-N,
 * low-sample flags, drill-down mapping, CSV export, excursionR.
 */
import { describe, expect, it } from "vitest";
import {
  buildChart,
  boxStatsOf,
  categoriesOf,
  chartResultToCsv,
  drillIsFilterable,
  drillToTradeFilters,
  excursionR,
  linearTrend,
  percentileOf,
  ChartConfigError,
  type BuilderTrade,
} from "@/lib/charts/builder";
import { chartConfigSchema } from "@/lib/validations/charts";
import { Decimal } from "@/lib/trading/dec";

// ── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
function trade(partial: Partial<BuilderTrade> = {}): BuilderTrade {
  seq += 1;
  const hour = partial.localHour ?? 10;
  return {
    id: `t${seq}`,
    entryTime: `2025-01-${String(10 + (seq % 10)).padStart(2, "0")}T0${Math.floor(hour / 10)}${hour % 10}:00:00.000Z`,
    exitTime: `2025-01-${String(10 + (seq % 10)).padStart(2, "0")}T12:00:00.000Z`,
    netPnl: "100",
    rMultiple: "1.5",
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
    mfeR: "2.5",
    maeR: "0.5",
    durationMin: 120,
    tags: [],
    mistakes: [],
    localDate: "2025-01-15",
    localEntryDate: "2025-01-15",
    localWeekday: 3, // Wednesday
    localHour: hour,
    localMonth: 1,
    localDayOfMonth: 15,
    localIsoWeek: 3,
    ...partial,
  };
}

function config(partial: Record<string, unknown>) {
  const parsed = chartConfigSchema.safeParse(partial);
  if (!parsed.success) {
    throw new Error(
      `test config invalid: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    );
  }
  return parsed.data;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

describe("chart builder — aggregations", () => {
  const trades = [
    trade({ rMultiple: "2" }),
    trade({ rMultiple: "-1" }),
    trade({ rMultiple: "4" }),
    trade({ rMultiple: null, netPnl: null }), // excluded from R stats
  ];

  it("sums per-trade measures per category", () => {
    const result = buildChart(
      trades,
      config({ x: "direction", y: "rMultiple", aggregation: "sum", chartType: "bar" })
    );
    const all = result.data.find((d) => d.key === "LONG");
    expect(all).toBeDefined();
    expect(all?.values.all).toBe(5); // 2 - 1 + 4
    expect(all?.total).toBe(4);
  });

  it("averages with exact decimal division", () => {
    const result = buildChart(
      trades,
      config({ x: "direction", y: "rMultiple", aggregation: "avg", chartType: "bar" })
    );
    expect(result.data[0]?.values.all).toBeCloseTo(5 / 3, 10);
  });

  it("median and percentile use linear interpolation", () => {
    const vals = [new Decimal(1), new Decimal(2), new Decimal(3), new Decimal(4)];
    expect(percentileOf(vals, 50)?.toNumber()).toBe(2.5);
    expect(percentileOf(vals, 25)?.toNumber()).toBe(1.75);
    expect(percentileOf(vals, 0)?.toNumber()).toBe(1);
    expect(percentileOf(vals, 100)?.toNumber()).toBe(4);
    expect(percentileOf([], 50)).toBeNull();

    const result = buildChart(
      [trade({ rMultiple: "1" }), trade({ rMultiple: "2" }), trade({ rMultiple: "3" }), trade({ rMultiple: "4" })],
      config({ x: "direction", y: "rMultiple", aggregation: "percentile", percentile: 25, chartType: "bar" })
    );
    expect(result.data[0]?.values.all).toBeCloseTo(1.75, 10);
  });

  it("min/max/count", () => {
    const min = buildChart(
      trades,
      config({ x: "direction", y: "rMultiple", aggregation: "min", chartType: "bar" })
    );
    const max = buildChart(
      trades,
      config({ x: "direction", y: "rMultiple", aggregation: "max", chartType: "bar" })
    );
    const count = buildChart(
      trades,
      config({ x: "direction", y: "rMultiple", aggregation: "count", chartType: "bar" })
    );
    expect(min.data[0]?.values.all).toBe(-1);
    expect(max.data[0]?.values.all).toBe(4);
    expect(count.data[0]?.values.all).toBe(3); // null R excluded
  });

  it("aggregate measures: winRate / expectancy / tradeCount / profitFactor / avgHoldingTime", () => {
    const mixed = [
      trade({ resultType: "WIN", netPnl: "100", rMultiple: "2" }),
      trade({ resultType: "LOSS", netPnl: "-50", rMultiple: "-1" }),
      trade({ resultType: "WIN", netPnl: "150", rMultiple: "3", durationMin: 300 }),
    ];
    const wr = buildChart(
      mixed,
      config({ x: "direction", y: "winRate", chartType: "bar" })
    );
    expect(wr.data[0]?.values.all).toBeCloseTo((2 / 3) * 100, 8);

    const ex = buildChart(
      mixed,
      config({ x: "direction", y: "expectancy", chartType: "bar" })
    );
    expect(ex.data[0]?.values.all).toBeCloseTo((2 - 1 + 3) / 3, 8);

    const tc = buildChart(
      mixed,
      config({ x: "direction", y: "tradeCount", chartType: "bar" })
    );
    expect(tc.data[0]?.values.all).toBe(3);

    const pf = buildChart(
      mixed,
      config({ x: "direction", y: "profitFactor", chartType: "bar" })
    );
    expect(pf.data[0]?.values.all).toBeCloseTo(250 / 50, 8);

    const ht = buildChart(
      mixed,
      config({ x: "direction", y: "avgHoldingTime", chartType: "bar" })
    );
    expect(ht.data[0]?.values.all).toBeCloseTo((120 + 120 + 300) / 3, 8);
  });

  it("profitFactor is null when there is no loss (∞ not plottable)", () => {
    const onlyWins = [trade({ netPnl: "100" }), trade({ netPnl: "50" })];
    const pf = buildChart(
      onlyWins,
      config({ x: "direction", y: "profitFactor", chartType: "bar" })
    );
    expect(pf.data[0]?.values.all).toBeNull();
  });
});

// ── Dimensions & buckets ──────────────────────────────────────────────────────

describe("chart builder — dimensions", () => {
  it("hourOfDay categories come from the timezone-aware localHour", () => {
    const t = trade({ localHour: 14 });
    expect(categoriesOf(t, "hourOfDay")).toEqual(["14"]);
    expect(categoriesOf({ ...t, localHour: null }, "hourOfDay")).toEqual([]);
  });

  it("dayOfWeek maps 1-7 → Mon-Sun", () => {
    expect(categoriesOf(trade({ localWeekday: 1 }), "dayOfWeek")).toEqual(["Mon"]);
    expect(categoriesOf(trade({ localWeekday: 7 }), "dayOfWeek")).toEqual(["Sun"]);
    expect(categoriesOf(trade({ localWeekday: 5 }), "dayOfWeek")).toEqual(["Fri"]);
  });

  it("multi-value tag/mistake dimensions fan out", () => {
    const t = trade({ tags: ["news", "london"], mistakes: ["fomo"] });
    expect(categoriesOf(t, "tag")).toEqual(["news", "london"]);
    expect(categoriesOf(t, "mistake")).toEqual(["fomo"]);
  });

  it("holding-time bucket edges", () => {
    expect(categoriesOf(trade({ durationMin: 4 }), "holdingTimeBucket")).toEqual(["under5m"]);
    expect(categoriesOf(trade({ durationMin: 5 }), "holdingTimeBucket")).toEqual(["5to15m"]);
    expect(categoriesOf(trade({ durationMin: 14.9 }), "holdingTimeBucket")).toEqual(["5to15m"]);
    expect(categoriesOf(trade({ durationMin: 15 }), "holdingTimeBucket")).toEqual(["15to60m"]);
    expect(categoriesOf(trade({ durationMin: 60 }), "holdingTimeBucket")).toEqual(["1to4h"]);
    expect(categoriesOf(trade({ durationMin: 239 }), "holdingTimeBucket")).toEqual(["1to4h"]);
    expect(categoriesOf(trade({ durationMin: 240 }), "holdingTimeBucket")).toEqual(["4to24h"]);
    expect(categoriesOf(trade({ durationMin: 1439 }), "holdingTimeBucket")).toEqual(["4to24h"]);
    expect(categoriesOf(trade({ durationMin: 1440 }), "holdingTimeBucket")).toEqual(["over24h"]);
    expect(categoriesOf(trade({ durationMin: null }), "holdingTimeBucket")).toEqual([]);
  });

  it("lot-size and risk-% bucket edges", () => {
    expect(categoriesOf(trade({ lots: "0.09" }), "lotSizeBucket")).toEqual(["under0.1"]);
    expect(categoriesOf(trade({ lots: "0.5" }), "lotSizeBucket")).toEqual(["0.5to1"]);
    expect(categoriesOf(trade({ lots: "5" }), "lotSizeBucket")).toEqual(["over5"]);
    expect(categoriesOf(trade({ riskPercent: "0.25" }), "riskPercentBucket")).toEqual(["0.25to0.5"]);
    expect(categoriesOf(trade({ riskPercent: "2" }), "riskPercentBucket")).toEqual(["over2"]);
  });

  it("excluded trades produce the missingValuesExcluded warning", () => {
    const result = buildChart(
      [trade({ session: null }), trade({ session: "LONDON" })],
      config({ x: "session", y: "rMultiple", aggregation: "avg", chartType: "bar" })
    );
    expect(result.excludedCount).toBe(1);
    expect(result.warnings).toContain("missingValuesExcluded");
  });
});

// ── Sorting / topN / low sample ───────────────────────────────────────────────

describe("chart builder — sorting, topN, low sample", () => {
  const trades = [
    trade({ localHour: 9, rMultiple: "1" }),
    trade({ localHour: 14, rMultiple: "5" }),
    trade({ localHour: 2, rMultiple: "-2" }),
  ];

  it("natural sort orders hours numerically", () => {
    const result = buildChart(
      trades,
      config({ x: "hourOfDay", y: "rMultiple", aggregation: "avg", chartType: "bar" })
    );
    expect(result.data.map((d) => d.key)).toEqual(["2", "9", "14"]);
  });

  it("valueDesc sorts by |value|", () => {
    const result = buildChart(
      trades,
      config({
        x: "hourOfDay",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "bar",
        sort: "valueDesc",
      })
    );
    // |5| > |−2| > |1| → 14, 2, 9
    expect(result.data.map((d) => d.key)).toEqual(["14", "2", "9"]);
  });

  it("topN keeps the largest |value| categories then re-sorts naturally", () => {
    const four = [
      trade({ localHour: 9, rMultiple: "1" }),
      trade({ localHour: 14, rMultiple: "5" }),
      trade({ localHour: 2, rMultiple: "-2" }),
      trade({ localHour: 20, rMultiple: "0.1" }),
    ];
    const result = buildChart(
      four,
      config({
        x: "hourOfDay",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "bar",
        topN: 3,
      })
    );
    // |5|, |−2|, |1| kept; |0.1| dropped → natural order 2, 9, 14
    expect(result.data.map((d) => d.key)).toEqual(["2", "9", "14"]);
    expect(result.warnings).toContain("topNApplied");
  });

  it("low-sample categories are flagged and warned", () => {
    const many = Array.from({ length: 10 }, () => trade({ session: "LONDON" }));
    const few = [trade({ session: "NEW_YORK" })];
    const result = buildChart(
      [...many, ...few],
      config({
        x: "session",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "bar",
        minSampleSize: 5,
      })
    );
    const ny = result.data.find((d) => d.key === "NEW_YORK");
    const london = result.data.find((d) => d.key === "LONDON");
    expect(ny?.lowSample).toBe(true);
    expect(london?.lowSample).toBe(false);
    expect(result.warnings).toContain("lowSampleCategories");
  });
});

// ── Group by ──────────────────────────────────────────────────────────────────

describe("chart builder — group-by series", () => {
  it("direction group-by splits values into LONG/SHORT series", () => {
    const trades = [
      trade({ direction: "LONG", rMultiple: "2" }),
      trade({ direction: "SHORT", rMultiple: "-1" }),
      trade({ direction: "LONG", rMultiple: "1" }),
    ];
    const result = buildChart(
      trades,
      config({
        x: "session",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "bar",
        groupBy: "direction",
      })
    );
    expect(result.series.map((s) => s.key)).toEqual(["LONG", "SHORT"]);
    const london = result.data.find((d) => d.key === "LONDON");
    expect(london?.values.LONG).toBe(1.5);
    expect(london?.values.SHORT).toBe(-1);
    expect(london?.total).toBe(3);
  });

  it("followedPlan null trades are excluded from the group", () => {
    const trades = [
      trade({ followedPlan: true, rMultiple: "1" }),
      trade({ followedPlan: null, rMultiple: "9" }),
    ];
    const result = buildChart(
      trades,
      config({
        x: "session",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "bar",
        groupBy: "followedPlan",
      })
    );
    const london = result.data.find((d) => d.key === "LONDON");
    expect(london?.values.yes).toBe(1);
    expect(london?.values.no).toBeNull();
  });
});

// ── Scatter / trend / histogram / box ────────────────────────────────────────

describe("chart builder — scatter, trend, histogram, box", () => {
  it("scatter emits raw points and a trend line with R²", () => {
    const trades = [
      trade({ durationMin: 10, rMultiple: "1" }),
      trade({ durationMin: 20, rMultiple: "2" }),
      trade({ durationMin: 30, rMultiple: "3" }),
    ];
    const result = buildChart(
      trades,
      config({
        x: "holdingTimeMin",
        y: "rMultiple",
        chartType: "scatter",
        showTrendLine: true,
      })
    );
    expect(result.points).toHaveLength(3);
    expect(result.trend).not.toBeNull();
    expect(result.trend?.slope).toBeCloseTo(0.1, 8);
    expect(result.trend?.r2).toBeCloseTo(1, 8);
  });

  it("scatter with tradeIndex x numbers trades 1..N", () => {
    const trades = [trade({}), trade({}), trade({})];
    const result = buildChart(
      trades,
      config({ x: "tradeIndex", y: "netPnl", chartType: "scatter" })
    );
    expect(result.points.map((p) => p.x)).toEqual([1, 2, 3]);
  });

  it("scatter excludes points with missing x or y", () => {
    const trades = [
      trade({ durationMin: 10, rMultiple: "1" }),
      trade({ durationMin: null, rMultiple: "1" }),
      trade({ durationMin: 10, rMultiple: null }),
    ];
    const result = buildChart(
      trades,
      config({ x: "holdingTimeMin", y: "rMultiple", chartType: "scatter" })
    );
    expect(result.points).toHaveLength(1);
    expect(result.excludedCount).toBe(2);
  });

  it("histogram bins all values including the max (last bin)", () => {
    const trades = [
      trade({ rMultiple: "0" }),
      trade({ rMultiple: "1" }),
      trade({ rMultiple: "2" }),
      trade({ rMultiple: "3" }),
    ];
    const result = buildChart(
      trades,
      config({ x: "rMultiple", chartType: "histogram", binCount: 5 })
    );
    expect(result.histogram).toHaveLength(5);
    const total = result.histogram.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(4);
    expect(result.histogram[4].count).toBe(1); // max value lands in the last bin
  });

  it("histogram with a single distinct value still produces bins", () => {
    const result = buildChart(
      [trade({ rMultiple: "1" })],
      config({ x: "rMultiple", chartType: "histogram" })
    );
    expect(result.histogram.length).toBeGreaterThan(0);
    expect(result.histogram[0].count).toBe(1);
  });

  it("box plot computes quartiles, whiskers and outliers (1.5 IQR)", () => {
    const stats = boxStatsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(stats).not.toBeNull();
    expect(stats?.median).toBeCloseTo(5.5, 6);
    expect(stats?.outliers).toEqual([100]);
    expect(stats?.whiskerHigh).toBe(9);
  });

  it("box plot per category via the builder", () => {
    const trades = [
      trade({ session: "LONDON", rMultiple: "1" }),
      trade({ session: "LONDON", rMultiple: "2" }),
      trade({ session: "NEW_YORK", rMultiple: "-1" }),
    ];
    const result = buildChart(
      trades,
      config({ x: "session", y: "rMultiple", chartType: "box" })
    );
    const london = result.data.find((d) => d.key === "LONDON");
    expect(london?.boxes?.all?.median).toBe(1.5);
    const ny = result.data.find((d) => d.key === "NEW_YORK");
    expect(ny?.boxes?.all?.median).toBe(-1);
  });
});

// ── Invalid combos ────────────────────────────────────────────────────────────

describe("chart builder — invalid combos (schema)", () => {
  it("rejects aggregate Y with an aggregation", () => {
    const r = chartConfigSchema.safeParse({
      x: "hourOfDay",
      y: "winRate",
      aggregation: "sum",
      chartType: "bar",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message === "aggregateMeasureTakesNoAggregation")).toBe(true);
  });

  it("rejects per-trade Y without an aggregation", () => {
    const r = chartConfigSchema.safeParse({
      x: "hourOfDay",
      y: "rMultiple",
      chartType: "bar",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message === "requiresAggregation")).toBe(true);
  });

  it("rejects numeric X on categorical charts", () => {
    const r = chartConfigSchema.safeParse({
      x: "rMultiple",
      y: "netPnl",
      aggregation: "avg",
      chartType: "bar",
    });
    expect(r.success).toBe(false);
    expect(
      r.error?.issues.some((i) => i.message === "categoricalChartRequiresDimensionX")
    ).toBe(true);
  });

  it("rejects histogram with a dimension X or a Y measure", () => {
    expect(
      chartConfigSchema.safeParse({ x: "hourOfDay", chartType: "histogram" }).success
    ).toBe(false);
    expect(
      chartConfigSchema.safeParse({
        x: "rMultiple",
        y: "netPnl",
        chartType: "histogram",
      }).success
    ).toBe(false);
  });

  it("rejects scatter with a categorical X or missing Y", () => {
    expect(
      chartConfigSchema.safeParse({ x: "session", y: "rMultiple", chartType: "scatter" }).success
    ).toBe(false);
    expect(
      chartConfigSchema.safeParse({ x: "tradeIndex", chartType: "scatter" }).success
    ).toBe(false);
  });

  it("rejects percentile without a value and box with an aggregation", () => {
    expect(
      chartConfigSchema.safeParse({
        x: "hourOfDay",
        y: "rMultiple",
        aggregation: "percentile",
        chartType: "bar",
      }).success
    ).toBe(false);
    expect(
      chartConfigSchema.safeParse({
        x: "hourOfDay",
        y: "rMultiple",
        aggregation: "avg",
        chartType: "box",
      }).success
    ).toBe(false);
  });

  it("rejects y2 equal to y and y2 outside bar/line/area", () => {
    expect(
      chartConfigSchema.safeParse({
        x: "hourOfDay",
        y: "rMultiple",
        aggregation: "avg",
        y2: "rMultiple",
        chartType: "bar",
      }).success
    ).toBe(false);
    expect(
      chartConfigSchema.safeParse({
        x: "session",
        y: "winRate",
        y2: "tradeCount",
        chartType: "box",
      }).success
    ).toBe(false);
  });

  it("buildChart throws ChartConfigError on engine-level violations", () => {
    // Bypass schema validation to hit the engine guards.
    expect(() =>
      buildChart([], {
        x: "rMultiple",
        chartType: "histogram",
        groupBy: "none",
        sort: "natural",
        minSampleSize: 0,
        showTrendLine: false,
        period: "all",
      } as never)
    ).not.toThrow(); // numeric x is fine here

    // Aggregate Y is meaningless on a scatter — engine rejects it.
    expect(() =>
      buildChart([], {
        x: "tradeIndex",
        y: "winRate",
        chartType: "scatter",
        groupBy: "none",
        sort: "natural",
        minSampleSize: 0,
        showTrendLine: false,
        period: "all",
      } as never)
    ).toThrow(ChartConfigError);

    // Missing Y on a categorical chart — engine rejects it.
    expect(() =>
      buildChart([], {
        x: "session",
        chartType: "bar",
        groupBy: "none",
        sort: "natural",
        minSampleSize: 0,
        showTrendLine: false,
        period: "all",
      } as never)
    ).toThrow(ChartConfigError);
  });
});

// ── excursionR (MFE/MAE in R) ────────────────────────────────────────────────

describe("chart builder — excursionR", () => {
  it("LONG: favorable above entry, adverse below, risk = entry − initial SL", () => {
    const r = excursionR("LONG", "100", "110", "95", "90", null);
    expect(r.mfeR).not.toBeNull();
    expect(r.maeR).not.toBeNull();
    expect(Number(r.mfeR)).toBeCloseTo(1, 8); // (110-100)/10
    expect(Number(r.maeR)).toBeCloseTo(0.5, 8); // (100-95)/10
  });

  it("SHORT: mirrored", () => {
    const r = excursionR("SHORT", "100", "90", "105", "110", null);
    expect(Number(r.mfeR)).toBeCloseTo(1, 8); // (100-90)/10
    expect(Number(r.maeR)).toBeCloseTo(0.5, 8); // (105-100)/10
  });

  it("falls back to the final SL when the initial SL is missing", () => {
    const r = excursionR("LONG", "100", "105", null, null, "95");
    expect(Number(r.mfeR)).toBeCloseTo(1, 8);
    expect(r.maeR).toBeNull();
  });

  it("returns nulls without a risk distance", () => {
    const r = excursionR("LONG", "100", "110", "95", null, null);
    expect(r.mfeR).toBeNull();
    expect(r.maeR).toBeNull();
  });

  it("JPY-style digits and XAUUSD-style digits work through string decimals", () => {
    const jpy = excursionR("LONG", "150.000", "151.500", "149.800", "149.500", null);
    expect(Number(jpy.mfeR)).toBeCloseTo(3, 6);
    // XAUUSD SHORT: risk = |2350.50 − 2355| = 4.5; favorable = 2350.50 − 2340 = 10.5
    const xau = excursionR("SHORT", "2350.50", "2340.00", "2353.00", "2355.00", null);
    expect(Number(xau.mfeR)).toBeCloseTo(10.5 / 4.5, 6);
  });
});

// ── Drill-down mapping ────────────────────────────────────────────────────────

describe("chart builder — drill-down", () => {
  it("maps mappable dimensions to trades filters", () => {
    expect(drillToTradeFilters("instrument", "EURUSD")).toEqual({ symbol: "EURUSD" });
    expect(drillToTradeFilters("direction", "SHORT")).toEqual({ direction: "SHORT" });
    expect(drillToTradeFilters("hourOfDay", "14")).toEqual({ entryHour: 14 });
    expect(drillToTradeFilters("dayOfWeek", "Fri")).toEqual({ entryWeekday: 5 });
  });

  it("non-filterable dimensions return an empty map and are flagged", () => {
    expect(drillToTradeFilters("tag", "news")).toEqual({});
    expect(drillToTradeFilters("holdingTimeBucket", "1to4h")).toEqual({});
    expect(drillIsFilterable("tag")).toBe(false);
    expect(drillIsFilterable("instrument")).toBe(true);
  });
});

// ── CSV export ────────────────────────────────────────────────────────────────

describe("chart builder — CSV export", () => {
  it("categorical CSV has key, series and n columns", () => {
    const result = buildChart(
      [trade({ rMultiple: "2" }), trade({ rMultiple: "-1" })],
      config({ x: "session", y: "rMultiple", aggregation: "avg", chartType: "bar" })
    );
    const csv = chartResultToCsv(result);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("key,all,n");
    expect(lines[1]).toContain("LONDON");
  });

  it("scatter CSV has x,y,group,tradeId", () => {
    const result = buildChart(
      [trade({})],
      config({ x: "tradeIndex", y: "rMultiple", chartType: "scatter" })
    );
    expect(chartResultToCsv(result).split("\n")[0]).toBe("x,y,group,tradeId");
  });

  it("histogram CSV has binFrom,binTo,count", () => {
    const result = buildChart(
      [trade({ rMultiple: "1" })],
      config({ x: "rMultiple", chartType: "histogram" })
    );
    expect(chartResultToCsv(result).split("\n")[0]).toBe("binFrom,binTo,count");
  });
});

// ── Empty input ───────────────────────────────────────────────────────────────

describe("chart builder — empty input", () => {
  it("empty trades produce an empty but valid result", () => {
    for (const chartType of ["bar", "scatter", "histogram", "box"] as const) {
      const cfg =
        chartType === "histogram"
          ? config({ x: "rMultiple", chartType })
          : chartType === "scatter"
            ? config({ x: "tradeIndex", y: "rMultiple", chartType })
            : chartType === "box"
              ? config({ x: "session", y: "rMultiple", chartType })
              : config({ x: "session", y: "rMultiple", aggregation: "avg", chartType });
      const result = buildChart([], cfg);
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.points).toHaveLength(0);
      expect(result.histogram).toHaveLength(0);
    }
  });

  it("single trade produces a single category", () => {
    const result = buildChart(
      [trade({})],
      config({ x: "session", y: "tradeCount", chartType: "bar" })
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.values.all).toBe(1);
  });
});

// ── linearTrend ───────────────────────────────────────────────────────────────

describe("linearTrend", () => {
  it("returns null for < 2 points or zero x variance", () => {
    expect(linearTrend([])).toBeNull();
    expect(linearTrend([[1, 1]])).toBeNull();
    expect(linearTrend([[1, 1], [1, 2]])).toBeNull();
  });

  it("fits a perfect line with R² = 1", () => {
    const t = linearTrend([
      [0, 1],
      [1, 3],
      [2, 5],
    ]);
    expect(t?.slope).toBeCloseTo(2, 8);
    expect(t?.intercept).toBeCloseTo(1, 8);
    expect(t?.r2).toBeCloseTo(1, 8);
  });
});
