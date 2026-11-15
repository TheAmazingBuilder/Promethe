/**
 * Metrics module — evaluator unit tests (v2.5 Module 1, spec §4.6).
 *
 * Filter semantics (groups AND, filters inside a group OR), every aggregate
 * on a crafted sample, empty/low-sample behaviour and formula mode
 * (sub-metrics on their own samples, division by zero, "inf" handling).
 */
import { describe, expect, it } from "vitest";
import {
  applyMetricFilters,
  evaluateMetric,
  type MetricDefinition,
  type MetricTrade,
} from "@/lib/metrics/evaluator";

// ── Factory ──────────────────────────────────────────────────────────────────

let seq = 0;
function makeTrade(over: Partial<MetricTrade> = {}): MetricTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    entryTime: "2025-03-01T09:00:00.000Z",
    exitTime: "2025-03-01T10:00:00.000Z",
    netPnl: "100",
    rMultiple: "1.5",
    resultType: "WIN",
    strategyName: "Breakout",
    symbol: "XAUUSD",
    direction: "LONG",
    session: "LONDON",
    lots: "0.5",
    pips: "25",
    riskPercent: "1",
    emotionBefore: "CALM",
    setupType: "Trend continuation",
    accountId: "acc1",
    tags: ["news"],
    localWeekday: 1,
    localHour: 9,
    durationMin: 60,
    ...over,
  };
}

const ids = (trades: MetricTrade[]) => trades.map((t) => t.id);

/** 4 closed trades: +100, +50, −30, −20 (2 WIN / 2 LOSS). */
function craftedSample(): MetricTrade[] {
  return [
    makeTrade({ id: "w1", netPnl: "100", rMultiple: "2", resultType: "WIN", lots: "0.5", pips: "25" }),
    makeTrade({ id: "w2", netPnl: "50", rMultiple: "1", resultType: "WIN", lots: "0.5", pips: "10" }),
    makeTrade({ id: "l1", netPnl: "-30", rMultiple: "-0.5", resultType: "LOSS", lots: "1", pips: "-8" }),
    makeTrade({ id: "l2", netPnl: "-20", rMultiple: "-0.5", resultType: "LOSS", lots: "1", pips: "-7" }),
  ];
}

// ── applyMetricFilters ───────────────────────────────────────────────────────

describe("applyMetricFilters", () => {
  /** 3 trades: a = XAUUSD/LONDON/9h/Mon/WIN, b = EURUSD/NY/10h/Tue/LOSS, c = USDJPY/LONDON/22h/Mon/WIN. */
  const sample = (): MetricTrade[] => [
    makeTrade({ id: "a" }),
    makeTrade({
      id: "b",
      symbol: "EURUSD",
      session: "NY",
      localHour: 10,
      localWeekday: 2,
      tags: [],
      resultType: "LOSS",
      emotionBefore: "TILT",
      accountId: "acc2",
      setupType: "Counter trend",
      strategyName: "Reversal",
      direction: "SHORT",
    }),
    makeTrade({ id: "c", symbol: "USDJPY", localHour: 22, tags: ["news", "asia"] }),
  ];

  it("no filter groups keep every trade", () => {
    const trades = sample();
    expect(applyMetricFilters(trades, [])).toEqual(trades);
  });

  it("single group, single filter — instrument", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "instrument", values: ["XAUUSD"] }] }]))
    ).toEqual(["a"]);
  });

  it("filters inside a group combine with OR (same field or different fields)", () => {
    expect(
      ids(
        applyMetricFilters(sample(), [
          { filters: [{ field: "instrument", values: ["XAUUSD", "EURUSD"] }] },
        ])
      )
    ).toEqual(["a", "b"]);
    expect(
      ids(
        applyMetricFilters(sample(), [
          {
            filters: [
              { field: "instrument", values: ["XAUUSD"] },
              { field: "session", values: ["NY"] },
            ],
          },
        ])
      )
    ).toEqual(["a", "b"]);
  });

  it("groups combine with AND", () => {
    expect(
      ids(
        applyMetricFilters(sample(), [
          { filters: [{ field: "instrument", values: ["XAUUSD", "USDJPY"] }] },
          { filters: [{ field: "session", values: ["LONDON"] }] },
        ])
      )
    ).toEqual(["a", "c"]);
    expect(
      ids(
        applyMetricFilters(sample(), [
          { filters: [{ field: "instrument", values: ["XAUUSD"] }] },
          { filters: [{ field: "session", values: ["NY"] }] },
        ])
      )
    ).toEqual([]);
  });

  it("hourRange '8-10' matches hour 9 but not hour 10 (end exclusive)", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "hourRange", values: ["8-10"] }] }]))
    ).toEqual(["a"]);
  });

  it("hourRange accepts several ranges (OR) and never matches a null hour", () => {
    expect(
      ids(
        applyMetricFilters(sample(), [{ filters: [{ field: "hourRange", values: ["8-10", "22-23"] }] }])
      )
    ).toEqual(["a", "c"]);
    expect(
      applyMetricFilters([makeTrade({ id: "n", localHour: null })], [
        { filters: [{ field: "hourRange", values: ["0-24"] }] },
      ])
    ).toEqual([]);
  });

  it("tag filter matches any trade tag", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "tag", values: ["news"] }] }]))
    ).toEqual(["a", "c"]);
  });

  it("weekday filter compares the local weekday as a string", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "weekday", values: ["1"] }] }]))
    ).toEqual(["a", "c"]);
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "weekday", values: ["2"] }] }]))
    ).toEqual(["b"]);
  });

  it("result filter", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "result", values: ["WIN"] }] }]))
    ).toEqual(["a", "c"]);
  });

  it("values that match no trade filter everything out", () => {
    expect(
      applyMetricFilters(sample(), [{ filters: [{ field: "instrument", values: ["BTCUSD"] }] }])
    ).toEqual([]);
  });

  it("emotion, account, setupType, strategy and direction filters", () => {
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "emotion", values: ["CALM"] }] }]))
    ).toEqual(["a", "c"]);
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "account", values: ["acc1"] }] }]))
    ).toEqual(["a", "c"]);
    expect(
      ids(
        applyMetricFilters(sample(), [
          { filters: [{ field: "setupType", values: ["Trend continuation"] }] },
        ])
      )
    ).toEqual(["a", "c"]);
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "strategy", values: ["Reversal"] }] }]))
    ).toEqual(["b"]);
    expect(
      ids(applyMetricFilters(sample(), [{ filters: [{ field: "direction", values: ["SHORT"] }] }]))
    ).toEqual(["b"]);
  });

  it("null trade fields never match", () => {
    const trades = [
      makeTrade({
        id: "n",
        strategyName: null,
        session: null,
        emotionBefore: null,
        setupType: null,
        resultType: null,
      }),
    ];
    expect(
      applyMetricFilters(trades, [{ filters: [{ field: "strategy", values: ["Breakout"] }] }])
    ).toEqual([]);
    expect(
      applyMetricFilters(trades, [{ filters: [{ field: "session", values: ["LONDON"] }] }])
    ).toEqual([]);
    expect(
      applyMetricFilters(trades, [{ filters: [{ field: "emotion", values: ["CALM"] }] }])
    ).toEqual([]);
    expect(
      applyMetricFilters(trades, [{ filters: [{ field: "setupType", values: ["Trend continuation"] }] }])
    ).toEqual([]);
    expect(
      applyMetricFilters(trades, [{ filters: [{ field: "result", values: ["WIN"] }] }])
    ).toEqual([]);
  });
});

// ── evaluateMetric — aggregates ───────────────────────────────────────────────

describe("evaluateMetric — aggregates", () => {
  it("count / netPnl / grossWin / grossLoss on the crafted sample", () => {
    const trades = craftedSample();
    expect(evaluateMetric({ aggregate: "count", filterGroups: [] }, trades).value).toBe("4");
    expect(evaluateMetric({ aggregate: "netPnl", filterGroups: [] }, trades).value).toBe("100");
    expect(evaluateMetric({ aggregate: "grossWin", filterGroups: [] }, trades).value).toBe("150");
    expect(evaluateMetric({ aggregate: "grossLoss", filterGroups: [] }, trades).value).toBe("-50");
  });

  it("winRate counts WIN result types (2 of 4 → 50.00)", () => {
    expect(evaluateMetric({ aggregate: "winRate", filterGroups: [] }, craftedSample()).value).toBe(
      "50.00"
    );
  });

  it("winRate falls back to positive netPnl when resultType is null", () => {
    const trades = [
      makeTrade({ id: "p", netPnl: "40", resultType: null }),
      makeTrade({ id: "q", netPnl: "-10", resultType: null }),
    ];
    expect(evaluateMetric({ aggregate: "winRate", filterGroups: [] }, trades).value).toBe("50.00");
  });

  it("avgPnl and expectancy aggregates", () => {
    const trades = craftedSample();
    expect(evaluateMetric({ aggregate: "avgPnl", filterGroups: [] }, trades).value).toBe("25");
    expect(evaluateMetric({ aggregate: "expectancyCurrency", filterGroups: [] }, trades).value).toBe(
      "25"
    );
  });

  it("profitFactor = grossWin / |grossLoss| (150/50 → 3.000)", () => {
    expect(
      evaluateMetric({ aggregate: "profitFactor", filterGroups: [] }, craftedSample()).value
    ).toBe("3.000");
  });

  it("profitFactor is the 'inf' sentinel when there are no losses", () => {
    const trades = [makeTrade({ netPnl: "10" }), makeTrade({ netPnl: "20" })];
    expect(evaluateMetric({ aggregate: "profitFactor", filterGroups: [] }, trades).value).toBe("inf");
  });

  it("avgR / totalR on rMultiples (2, 1, −0.5, −0.5)", () => {
    const trades = craftedSample();
    expect(evaluateMetric({ aggregate: "totalR", filterGroups: [] }, trades).value).toBe("2");
    expect(evaluateMetric({ aggregate: "avgR", filterGroups: [] }, trades).value).toBe("0.5");
    expect(evaluateMetric({ aggregate: "expectancyR", filterGroups: [] }, trades).value).toBe("0.5");
  });

  it("totalPips / avgLots / avgDurationMin", () => {
    const trades = craftedSample(); // pips 25+10−8−7 = 20 ; lots (0.5+0.5+1+1)/4
    expect(evaluateMetric({ aggregate: "totalPips", filterGroups: [] }, trades).value).toBe("20");
    expect(evaluateMetric({ aggregate: "avgLots", filterGroups: [] }, trades).value).toBe("0.75");
    expect(evaluateMetric({ aggregate: "avgDurationMin", filterGroups: [] }, trades).value).toBe("60");
  });

  it("payoffRatio = avgWin / |avgLoss| (75/25 → 3.000)", () => {
    expect(
      evaluateMetric({ aggregate: "payoffRatio", filterGroups: [] }, craftedSample()).value
    ).toBe("3.000");
  });

  it("medianPnl — even and odd sample sizes", () => {
    const four = craftedSample(); // sorted [−30, −20, 50, 100] → (−20+50)/2
    expect(evaluateMetric({ aggregate: "medianPnl", filterGroups: [] }, four).value).toBe("15");
    const three = four.slice(0, 3); // sorted [−30, 50, 100] → middle
    expect(evaluateMetric({ aggregate: "medianPnl", filterGroups: [] }, three).value).toBe("50");
  });

  it("aggregates run on the definition's filtered sample", () => {
    const def: MetricDefinition = {
      aggregate: "count",
      filterGroups: [{ filters: [{ field: "instrument", values: ["EURUSD"] }] }],
    };
    const result = evaluateMetric(def, [
      makeTrade({ symbol: "XAUUSD" }),
      makeTrade({ symbol: "EURUSD" }),
      makeTrade({ symbol: "EURUSD" }),
    ]);
    expect(result.value).toBe("2");
    expect(result.sampleSize).toBe(2);
  });
});

// ── evaluateMetric — empty and low samples ────────────────────────────────────

describe("evaluateMetric — empty and low samples", () => {
  const noMatch = [{ filters: [{ field: "instrument", values: ["NOPE"] }] }];

  it("empty sample → value null, sampleSize 0, lowSample false", () => {
    const result = evaluateMetric({ aggregate: "netPnl", filterGroups: noMatch }, craftedSample());
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.lowSample).toBe(false);
  });

  it("count on an empty sample is '0'", () => {
    const result = evaluateMetric({ aggregate: "count", filterGroups: noMatch }, craftedSample());
    expect(result.value).toBe("0");
    expect(result.sampleSize).toBe(0);
  });

  it("an empty trade list behaves like an empty sample", () => {
    const result = evaluateMetric({ aggregate: "netPnl", filterGroups: [] }, []);
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.lowSample).toBe(false);
  });

  it("lowSample: true below 10 trades, false from 10 up", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => makeTrade({ id: `s${i}`, netPnl: "10" }));

    const r5 = evaluateMetric({ aggregate: "count", filterGroups: [] }, make(5));
    expect(r5.sampleSize).toBe(5);
    expect(r5.lowSample).toBe(true);

    const r10 = evaluateMetric({ aggregate: "count", filterGroups: [] }, make(10));
    expect(r10.sampleSize).toBe(10);
    expect(r10.lowSample).toBe(false);

    const r15 = evaluateMetric({ aggregate: "count", filterGroups: [] }, make(15));
    expect(r15.sampleSize).toBe(15);
    expect(r15.lowSample).toBe(false);
  });
});

// ── evaluateMetric — formula mode ─────────────────────────────────────────────

describe("evaluateMetric — formula mode", () => {
  /** XAUUSD wins +100/+100, EURUSD losses −50/−50 → A = netPnl(all) = 100, B = netPnl(XAUUSD) = 200. */
  const formulaTrades = (): MetricTrade[] => [
    makeTrade({ id: "x1", symbol: "XAUUSD", netPnl: "100", resultType: "WIN" }),
    makeTrade({ id: "x2", symbol: "XAUUSD", netPnl: "100", resultType: "WIN" }),
    makeTrade({ id: "e1", symbol: "EURUSD", netPnl: "-50", resultType: "LOSS" }),
    makeTrade({ id: "e2", symbol: "EURUSD", netPnl: "-50", resultType: "LOSS" }),
  ];

  /** Share of total PnL coming from XAUUSD: A / B * 100. */
  const shareDefinition: MetricDefinition = {
    aggregate: "netPnl",
    filterGroups: [],
    formula: {
      expression: "A / B * 100",
      subMetrics: [
        { name: "A", aggregate: "netPnl", filterGroups: [] },
        {
          name: "B",
          aggregate: "netPnl",
          filterGroups: [{ filters: [{ field: "instrument", values: ["XAUUSD"] }] }],
        },
      ],
    },
  };

  it("computes each sub-metric on its own sample and combines them", () => {
    const result = evaluateMetric(shareDefinition, formulaTrades());
    expect(result.value).toBe("50"); // 100 / 200 * 100
    expect(result.sampleSize).toBe(4); // union base, not the sub-metric sample
    expect(result.lowSample).toBe(true);
  });

  it("division by zero in the formula yields null", () => {
    // XAUUSD subset sums to 0 → B = 0 → A / B * 100 = null.
    const trades = [
      makeTrade({ symbol: "XAUUSD", netPnl: "50" }),
      makeTrade({ symbol: "XAUUSD", netPnl: "-50" }),
      makeTrade({ symbol: "EURUSD", netPnl: "30" }),
    ];
    const result = evaluateMetric(shareDefinition, trades);
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(3);
  });

  it("a null sub-metric (empty sub-sample) propagates null", () => {
    const trades = [makeTrade({ symbol: "EURUSD", netPnl: "30" })]; // no XAUUSD trades → B null
    const result = evaluateMetric(shareDefinition, trades);
    expect(result.value).toBeNull();
  });

  it("'inf' profitFactor sub-metrics evaluate to null (non-finite)", () => {
    // All winners → profitFactor = "inf" → +Infinity → the evaluator's
    // variable lookup rejects non-finite values, so the formula result is null.
    const trades = [
      makeTrade({ netPnl: "100", resultType: "WIN" }),
      makeTrade({ netPnl: "50", resultType: "WIN" }),
    ];
    const def: MetricDefinition = {
      aggregate: "netPnl",
      filterGroups: [],
      formula: {
        expression: "A + B",
        subMetrics: [
          { name: "A", aggregate: "netPnl", filterGroups: [] },
          { name: "B", aggregate: "profitFactor", filterGroups: [] },
        ],
      },
    };
    const result = evaluateMetric(def, trades);
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(2);
  });

  it("an invalid formula expression yields null but keeps the sample size", () => {
    const def: MetricDefinition = {
      ...shareDefinition,
      formula: { ...shareDefinition.formula!, expression: "A +" },
    };
    const result = evaluateMetric(def, formulaTrades());
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(4);
  });

  it("sub-metrics may use different aggregates (grossWin share)", () => {
    const def: MetricDefinition = {
      aggregate: "netPnl",
      filterGroups: [],
      formula: {
        expression: "A / B",
        subMetrics: [
          { name: "A", aggregate: "grossWin", filterGroups: [{ filters: [{ field: "instrument", values: ["XAUUSD"] }] }] },
          { name: "B", aggregate: "netPnl", filterGroups: [] },
        ],
      },
    };
    // A = grossWin(XAUUSD) = 200, B = netPnl(all) = 100 → 2.
    const result = evaluateMetric(def, formulaTrades());
    expect(result.value).toBe("2");
  });
});
