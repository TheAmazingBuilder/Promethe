/**
 * Cross-analysis (§25.7) - unit tests.
 *
 * Pure functions only (no DB): the checklist / review / version groups,
 * the sample bars, the grade mix, the module wiring and the UI copy.
 * The hard rule pinned here: a comparison is an observed association,
 * never a causal claim - the copy must not contain causal wording, and
 * no difference is drawn under 10 trades per group.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeAdvancedAnalytics,
  computeAdvancedAnalyticsModules,
  computeCrossAnalysis,
  MIN_SAMPLE_CROSS,
  MIN_TRADES_CROSS,
  REVIEW_COMPLETENESS_SLOTS,
  reviewCompletenessOf,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { ADVANCED_MODULES } from "@/lib/validations/analytics";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { parsePathname, routeToPath } from "@/lib/routes";

const messages = JSON.parse(
  readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")
) as Record<string, any>;

let seq = 0;

const FULL_REVIEW: NonNullable<AdvancedTrade["review"]> = {
  followedPlan: true,
  planAdherenceScore: 4,
  executionQuality: 4,
  entryQuality: 4,
  exitQuality: 4,
  riskManagementScore: 4,
  emotionalControlScore: 4,
  wouldTakeAgain: "YES",
  mistakeTags: [],
  customAnswers: [
    {
      questionId: "q1",
      question: "Did you wait for confirmation?",
      type: "BOOLEAN",
      answer: true,
    },
  ],
};

function makeTrade(partial: Partial<AdvancedTrade> = {}): AdvancedTrade {
  seq += 1;
  const day = String(1 + (seq % 28)).padStart(2, "0");
  const base: AdvancedTrade = {
    id: `trade-${seq}`,
    exitTime: `2026-01-${day}T12:00:00.000Z`,
    entryTime: `2026-01-${day}T10:00:00.000Z`,
    netPnl: "100",
    rMultiple: "1",
    resultType: "WIN",
    strategyId: null,
    strategyName: null,
    instrumentId: "inst-1",
    symbol: "XAUUSD",
    direction: "LONG",
    session: "LONDON",
    lots: "0.1",
    accountId: "acc-1",
    accountName: "Main",
    timeframe: "H1",
    setupType: "BOS",
    marketCondition: null,
    exitReason: "MANUAL",
    emotionBefore: null,
    followedPlan: true,
    commission: "0",
    swap: "0",
    fees: "0",
    localDate: `2026-01-${day}`,
    localWeekday: 3,
    localHour: 10,
    durationMin: 120,
    customFields: null,
    mfeR: null,
    maeR: null,
    takeProfit: null,
    plannedRR: null,
    entryPrice: "2000",
    initialStopLoss: "1990",
    tags: [],
    grade: null,
    confluenceTags: [],
    violationCount: 0,
    strategyVersion: null,
    checklistComplete: null,
    playbookMatch: null,
    review: null,
    riskPercent: "1",
    setupQualityRating: 4,
    localYear: 2026,
    localMonth: 1,
    localDayOfMonth: Number(day),
    localIsoWeek: 2,
    localEntryDate: `2026-01-${day}`,
    timeInProfitMin: null,
    timeInLossMin: null,
  };
  return { ...base, ...partial };
}

function winTrade(partial: Partial<AdvancedTrade> = {}): AdvancedTrade {
  return makeTrade({
    resultType: "WIN",
    rMultiple: "2",
    netPnl: "200",
    ...partial,
  });
}

function lossTrade(partial: Partial<AdvancedTrade> = {}): AdvancedTrade {
  return makeTrade({
    resultType: "LOSS",
    rMultiple: "-1",
    netPnl: "-100",
    ...partial,
  });
}

describe("thresholds - the sample bars", () => {
  it("uses the documented minimum sample of 10 trades per group", () => {
    expect(MIN_SAMPLE_CROSS).toBe(10);
  });

  it("shows its tables only from 5 closed trades", () => {
    expect(MIN_TRADES_CROSS).toBe(5);
  });

  it("counts nine review completeness slots", () => {
    expect(REVIEW_COMPLETENESS_SLOTS).toBe(9);
  });
});

describe("computeCrossAnalysis - honest zeros on an empty scope", () => {
  it("returns zero shells with no comparison drawn", () => {
    const result = computeCrossAnalysis([]);
    expect(result.total).toBe(0);
    expect(result.checklist.complete.count).toBe(0);
    expect(result.checklist.incomplete.count).toBe(0);
    expect(result.checklist.noChecklist.count).toBe(0);
    expect(result.checklist.comparable).toBe(false);
    expect(result.checklist.avgRDiff).toBeNull();
    expect(result.checklist.winRateDiff).toBeNull();
    expect(result.review.reviewed.count).toBe(0);
    expect(result.review.notReviewed.count).toBe(0);
    expect(result.review.avgCompleteness).toBeNull();
    expect(result.versions).toEqual([]);
  });
});

describe("computeCrossAnalysis - checklist compliance vs outcome", () => {
  it("splits complete / incomplete / no-checklist and never compares under 10 per group", () => {
    const trades = [
      winTrade({ checklistComplete: true }),
      winTrade({ checklistComplete: true }),
      lossTrade({ checklistComplete: false }),
      makeTrade({ checklistComplete: null, grade: "A" }),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.total).toBe(4);
    expect(result.checklist.complete.count).toBe(2);
    expect(result.checklist.complete.winRate).toBe(100);
    expect(result.checklist.complete.avgR).toBe(2);
    expect(result.checklist.complete.netPnl).toBe("400");
    expect(result.checklist.incomplete.count).toBe(1);
    expect(result.checklist.incomplete.avgR).toBe(-1);
    expect(result.checklist.noChecklist.count).toBe(1);
    expect(result.checklist.comparable).toBe(false);
    expect(result.checklist.avgRDiff).toBeNull();
    expect(result.checklist.winRateDiff).toBeNull();
  });

  it("draws the difference only when both groups meet the bar", () => {
    const trades = [
      ...Array.from({ length: 10 }, () => winTrade({ checklistComplete: true })),
      ...Array.from({ length: 10 }, () => lossTrade({ checklistComplete: false })),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.checklist.comparable).toBe(true);
    expect(result.checklist.avgRDiff).toBe(3);
    expect(result.checklist.winRateDiff).toBe(100);
    expect(result.checklist.complete.totalR).toBe(20);
    expect(result.checklist.incomplete.totalR).toBe(-10);
  });

  it("counts trades without an R multiple for win rate and net P&L only", () => {
    const trades = [
      makeTrade({
        checklistComplete: true,
        resultType: "WIN",
        rMultiple: null,
        netPnl: "50",
      }),
      makeTrade({
        checklistComplete: true,
        resultType: "LOSS",
        rMultiple: null,
        netPnl: "-25",
      }),
    ];
    const result = computeCrossAnalysis(trades);
    const group = result.checklist.complete;
    expect(group.count).toBe(2);
    expect(group.rSampleSize).toBe(0);
    expect(group.winRate).toBe(50);
    expect(group.avgR).toBeNull();
    expect(group.netPnl).toBe("25");
  });

  it("carries the grade mix per group, counts only", () => {
    const trades = [
      winTrade({ checklistComplete: true, grade: "A+" }),
      winTrade({ checklistComplete: true, grade: "A" }),
      lossTrade({ checklistComplete: true }),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.checklist.complete.gradeMix).toEqual({
      plus: 1,
      a: 1,
      b: 0,
      c: 0,
      ungraded: 1,
    });
  });
});

describe("reviewCompletenessOf - nine slots, mistake tags excluded", () => {
  it("returns null when the trade was never reviewed", () => {
    expect(reviewCompletenessOf(makeTrade({ review: null }))).toBeNull();
  });

  it("returns 1 when every slot is filled", () => {
    expect(reviewCompletenessOf(makeTrade({ review: FULL_REVIEW }))).toBe(1);
  });

  it("counts only filled slots, and ignores mistake tags", () => {
    const partial = reviewCompletenessOf(
      makeTrade({
        review: {
          ...FULL_REVIEW,
          planAdherenceScore: null,
          executionQuality: null,
          customAnswers: [],
          mistakeTags: ["m1", "m2"],
        },
      })
    );
    expect(partial).toBeCloseTo(6 / 9, 10);
  });
});

describe("computeCrossAnalysis - review quality vs outcome", () => {
  it("splits reviewed / not reviewed and full / partial reviews", () => {
    const trades = [
      winTrade({ review: FULL_REVIEW }),
      lossTrade({ review: { ...FULL_REVIEW, wouldTakeAgain: null } }),
      winTrade({ review: null }),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.review.reviewed.count).toBe(2);
    expect(result.review.notReviewed.count).toBe(1);
    expect(result.review.reviewedFull.count).toBe(1);
    expect(result.review.reviewedPartial.count).toBe(1);
    expect(result.review.avgCompleteness).toBe(0.94);
    expect(result.review.comparable).toBe(false);
  });

  it("draws the reviewed difference only at the sample bar", () => {
    const trades = [
      ...Array.from({ length: 10 }, () => winTrade({ review: FULL_REVIEW })),
      ...Array.from({ length: 10 }, () => lossTrade({ review: null })),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.review.comparable).toBe(true);
    expect(result.review.avgRDiff).toBe(3);
    expect(result.review.winRateDiff).toBe(100);
  });
});

describe("computeCrossAnalysis - strategy version vs outcome", () => {
  it("groups by strategy and frozen version, pre-versioning kept apart", () => {
    const trades = [
      winTrade({ strategyId: "s1", strategyName: "Alpha", strategyVersion: 2 }),
      lossTrade({ strategyId: "s1", strategyName: "Alpha", strategyVersion: 2 }),
      winTrade({ strategyId: "s1", strategyName: "Alpha", strategyVersion: 1 }),
      winTrade({ strategyId: "s2", strategyName: "Beta", strategyVersion: null }),
      lossTrade({ strategyId: null, strategyName: null, strategyVersion: null }),
    ];
    const result = computeCrossAnalysis(trades);
    expect(result.versions).toHaveLength(4);
    const [alpha2, alpha1, beta, none] = result.versions;
    expect(alpha2.strategyName).toBe("Alpha");
    expect(alpha2.version).toBe(2);
    expect(alpha2.count).toBe(2);
    expect(alpha2.winRate).toBe(50);
    expect(alpha1.version).toBe(1);
    expect(alpha1.count).toBe(1);
    expect(beta.strategyName).toBe("Beta");
    expect(beta.version).toBeNull();
    expect(none.strategyName).toBeNull();
    expect(none.strategyId).toBeNull();
  });
});

describe("module wiring - cross-analysis is a first-class module", () => {
  it("lists cross-analysis among the advanced modules", () => {
    expect([...ADVANCED_MODULES]).toContain("cross-analysis");
  });

  it("computes only the requested module", () => {
    const trades = [winTrade({ checklistComplete: true })];
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const partial = computeAdvancedAnalyticsModules(trades, stats, advanced, [
      "cross-analysis",
    ]);
    expect(partial.crossAnalysis?.total).toBe(1);
    expect(partial.grades).toBeUndefined();
  });

  it("includes cross-analysis in the full computation", () => {
    const trades = [winTrade({ checklistComplete: true })];
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const payload = computeAdvancedAnalytics(trades, stats, advanced);
    expect(payload.crossAnalysis.total).toBe(1);
    expect(payload.grades.total).toBe(1);
  });
});

describe("routes - /analytics/cross-analysis", () => {
  it("parses and builds the cross-analysis tab path", () => {
    const route = parsePathname(
      "/analytics/cross-analysis",
      new URLSearchParams()
    );
    expect(route.view).toBe("analytics-cross-analysis");
    expect(routeToPath({ view: "analytics-cross-analysis" })).toBe(
      "/analytics/cross-analysis"
    );
  });
});

describe("copy - associations, never causal claims", () => {
  const cross = messages.analytics.advanced.crossAnalysis as Record<
    string,
    string
  >;
  const banned = [
    "causes",
    "cause ",
    "improves",
    "improve ",
    "leads to",
    "because",
    "thanks to",
    "will improve",
    "makes you",
  ];

  it("has the causation note, framed as observed association", () => {
    expect(cross.causationNote).toContain("observed association");
    expect(cross.causationNote).toContain("does not prove a link");
  });

  it("contains no causal wording in any cross-analysis string", () => {
    for (const [key, value] of Object.entries(cross)) {
      for (const word of banned) {
        expect(
          value.toLowerCase(),
          `crossAnalysis.${key} must not say "${word}"`
        ).not.toContain(word);
      }
    }
  });

  it("labels the tab in the analytics navigation", () => {
    expect(messages.analytics.advanced.tabs["cross-analysis"]).toBe(
      "Cross-analysis"
    );
  });
});
