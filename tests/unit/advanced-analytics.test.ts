/**
 * Advanced analytics engines (v2.5 Module 6) — smoke tests.
 *
 * Pure functions only (no DB): stats helpers, lifecycle / exits /
 * setups / sequences / anomalies. Thresholds asserted here are the ones
 * documented in the UI.
 */
import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg,
  binomialTwoSidedP,
  mad,
  robustZ,
  wilsonInterval,
} from "@/lib/analytics/stats";
import {
  computeAnomalies,
  computeExits,
  computeLifecycle,
  computeSequences,
  computeSetupRanking,
  computeSeasonality,
  computeTraderScore,
  computeTradeReviewAnalytics,
  isAlmostTp,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";

let seq = 0;

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
    violationCount: 0,
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

describe("stats helpers", () => {
  it("wilson interval brackets the observed rate", () => {
    const iv = wilsonInterval(50, 100);
    expect(iv).not.toBeNull();
    expect(iv!.lower).toBeLessThan(0.5);
    expect(iv!.upper).toBeGreaterThan(0.5);
    expect(iv!.center).toBeCloseTo(0.5, 1);
  });

  it("wilson interval tightens with sample size", () => {
    const small = wilsonInterval(5, 10)!;
    const big = wilsonInterval(500, 1000)!;
    expect(big.upper - big.lower).toBeLessThan(small.upper - small.lower);
  });

  it("adjusts multiple p-values with Benjamini-Hochberg in input order", () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03])).toEqual([0.03, 0.04, 0.04]);
    expect(benjaminiHochberg([])).toEqual([]);
  });
  it("binomial two-sided p-value: balanced sample is not extreme", () => {
    const p = binomialTwoSidedP(50, 100, 0.5);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.9);
  });

  it("binomial two-sided p-value: extreme sample is significant", () => {
    const p = binomialTwoSidedP(0, 10, 0.5);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.01);
  });

  it("robust z-score flags a far outlier, not the bulk", () => {
    const values = Array.from({ length: 20 }, () => 0.5);
    const stats = mad(values);
    expect(stats).not.toBeNull();
    // Zero spread: nothing can be an outlier.
    expect(robustZ(8, values)).toBeNull();
    const spread = [...values, 0.4, 0.6, 0.45, 0.55];
    expect(robustZ(8, spread)).not.toBeNull();
    expect(Math.abs(robustZ(8, spread)!)).toBeGreaterThan(3);
    expect(Math.abs(robustZ(0.5, spread)!)).toBeLessThan(1);
  });
});

describe("structured trade reviews", () => {
  it("calculates review coverage and score averages from answered samples only", () => {
    const trades = [
      makeTrade({ review: {
        followedPlan: true, planAdherenceScore: 5, executionQuality: 4,
        entryQuality: 4, exitQuality: 3, riskManagementScore: 5,
        emotionalControlScore: 4, wouldTakeAgain: "YES", mistakeTags: ["FOMO"],
      }, playbookMatch: "MATCHED" }),
      makeTrade({ review: {
        followedPlan: false, planAdherenceScore: 2, executionQuality: null,
        entryQuality: null, exitQuality: null, riskManagementScore: 3,
        emotionalControlScore: null, wouldTakeAgain: "NO", mistakeTags: ["FOMO", "EARLY_EXIT"],
      }, playbookMatch: "OFF_PLAYBOOK" }),
      makeTrade({ review: null }),
    ];
    const result = computeTradeReviewAnalytics(trades);
    expect(result.closedTrades).toBe(3);
    expect(result.reviewedTrades).toBe(2);
    expect(result.coveragePct).toBeCloseTo(66.7, 1);
    expect(result.plan.ratePct).toBe(50);
    expect(result.scores.planAdherence).toEqual({ average: 3.5, count: 2 });
    expect(result.scores.execution).toEqual({ average: 4, count: 1 });
    expect(result.wouldTakeAgain).toEqual({ yes: 1, no: 1, maybe: 0, unanswered: 0 });
    expect(result.playbookMatch.matched).toBe(1);
    expect(result.playbookMatch.offPlaybook).toBe(1);
    expect(result.topMistakes).toEqual([
      { label: "FOMO", count: 2 },
      { label: "EARLY_EXIT", count: 1 },
    ]);
  });

  it("keeps missing reviews and unanswered review fields distinct", () => {
    const result = computeTradeReviewAnalytics([
      makeTrade({ review: {
        followedPlan: null, planAdherenceScore: null, executionQuality: null,
        entryQuality: null, exitQuality: null, riskManagementScore: null,
        emotionalControlScore: null, wouldTakeAgain: null, mistakeTags: [],
      }, playbookMatch: null }),
    ]);
    expect(result.coveragePct).toBe(100);
    expect(result.plan.ratePct).toBeNull();
    expect(result.plan.unanswered).toBe(1);
    expect(result.scores.entry).toEqual({ average: null, count: 0 });
    expect(result.wouldTakeAgain.unanswered).toBe(1);
    expect(result.playbookMatch.unclassified).toBe(1);
  });

  it("aggregates custom question snapshots without exposing written answers", () => {
    const trades = [4, 2].map((score, index) => makeTrade({ review: {
      followedPlan: null, planAdherenceScore: null, executionQuality: null,
      entryQuality: null, exitQuality: null, riskManagementScore: null,
      emotionalControlScore: null, wouldTakeAgain: null, mistakeTags: [],
      customAnswers: [
        { questionId: "q-scale", question: "Setup clarity", type: "SCALE", answer: score },
        { questionId: "q-bool", question: "Waited for confirmation", type: "BOOLEAN", answer: index === 0 },
        { questionId: "q-text", question: "What did you learn?", type: "TEXT", answer: `private answer ${index}` },
      ],
    } }));
    const result = computeTradeReviewAnalytics(trades);
    expect(result.customQuestions).toEqual([
      { questionId: "q-bool", question: "Waited for confirmation", type: "BOOLEAN", answered: 2, average: null, scaleDistribution: [0, 0, 0, 0, 0], booleanYes: 1, booleanNo: 1 },
      { questionId: "q-scale", question: "Setup clarity", type: "SCALE", answered: 2, average: 3, scaleDistribution: [0, 1, 0, 1, 0], booleanYes: 0, booleanNo: 0 },
      { questionId: "q-text", question: "What did you learn?", type: "TEXT", answered: 2, average: null, scaleDistribution: [0, 0, 0, 0, 0], booleanYes: 0, booleanNo: 0 },
    ]);
    expect(JSON.stringify(result.customQuestions)).not.toContain("private answer");
  });
});

describe("lifecycle", () => {
  it("flags almost-TP at 90% of the planned target, not on a TP hit", () => {
    const almost = makeTrade({
      plannedRR: "2",
      mfeR: "1.9",
      exitReason: "MANUAL",
    });
    const hit = makeTrade({
      plannedRR: "2",
      mfeR: "2",
      exitReason: "TP_HIT",
    });
    const far = makeTrade({ plannedRR: "2", mfeR: "1", exitReason: "MANUAL" });
    expect(isAlmostTp(almost)).toBe(true);
    expect(isAlmostTp(hit)).toBe(false);
    expect(isAlmostTp(far)).toBe(false);
  });

  it("computes MFE/MAE averages and the almost-TP list", () => {
    const trades = [
      makeTrade({ mfeR: "2", maeR: "0.5", plannedRR: "2", rMultiple: "1" }),
      makeTrade({ mfeR: "0.4", maeR: "1", plannedRR: "2", rMultiple: "-1", resultType: "LOSS", netPnl: "-100" }),
    ];
    const res = computeLifecycle(trades);
    expect(res.total).toBe(2);
    expect(res.withMfe).toBe(2);
    expect(res.avgMfeR).toBeCloseTo(1.2, 5);
    expect(res.almostTpCount).toBe(1);
  });

  it("uses the MAE sample independently when some trades have no MAE", () => {
    const trades = [
      makeTrade({ mfeR: "2", maeR: "0.5" }),
      makeTrade({ mfeR: "1", maeR: null }),
      makeTrade({ mfeR: null, maeR: "0.25" }),
    ];
    const res = computeLifecycle(trades);
    expect(res.withMfe).toBe(2);
    expect(res.withMae).toBe(2);
    expect(res.avgMfeR).toBeCloseTo(1.5, 5);
    expect(res.avgMaeR).toBe(0.38); // Lifecycle values are rounded to two decimals.
    expect(res.maeBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });
});

describe("exits", () => {
  it("computes capture ratio, left on the table and fixed-TP simulations", () => {
    const trades = [
      makeTrade({ mfeR: "2.5", rMultiple: "1", resultType: "WIN" }),
      makeTrade({ mfeR: "0.5", rMultiple: "-1", resultType: "LOSS", netPnl: "-100" }),
    ];
    const res = computeExits(trades);
    expect(res.withMfe).toBe(2);
    // Trade 1: 1 / 2.5 = 0.4. Trade 2: -1 / 0.5 = -2 (gave back the peak
    // and more). Mean capture is negative by design here.
    expect(res.avgCaptureRatio).toBeCloseTo(-0.8, 5);
    // Left on the table: max(0, 2.5-1) = 1.5 and max(0, 0.5-(-1)) = 1.5.
    expect(res.avgLeftOnTableR).toBeCloseTo(1.5, 5);
    const fixed2 = res.simulations.find((s) => s.id === "fixed2")!;
    expect(fixed2.totalR).toBeCloseTo(1, 5); // 2R on trade 1, -1R on trade 2
    const trailing = res.simulations.find((s) => s.id === "trailing")!;
    expect(trailing.totalR).toBeCloseTo(1, 5); // (2.5-0.5) + (-1)
  });
});

describe("setups", () => {
  it("categorises proven / promising / unproven / losing", () => {
    const proven = Array.from({ length: 30 }, () =>
      makeTrade({ setupType: "A", rMultiple: "0.5", resultType: "WIN" })
    );
    // 24 wins / 30: Wilson lower bound well above 0.35.
    for (let i = 0; i < 6; i++) {
      proven[i] = { ...proven[i], rMultiple: "-1", resultType: "LOSS", netPnl: "-100" };
    }
    const promising = Array.from({ length: 12 }, () =>
      makeTrade({ setupType: "B", rMultiple: "0.4", resultType: "WIN" })
    );
    const unproven = Array.from({ length: 4 }, () =>
      makeTrade({ setupType: "C", rMultiple: "1", resultType: "WIN" })
    );
    const losing = Array.from({ length: 10 }, () =>
      makeTrade({ setupType: "D", rMultiple: "-0.5", resultType: "LOSS", netPnl: "-50" })
    );
    const ranks = computeSetupRanking([
      ...proven,
      ...promising,
      ...unproven,
      ...losing,
    ]);
    const byKey = new Map(ranks.map((r) => [r.key, r]));
    expect(byKey.get("A")!.category).toBe("proven");
    expect(byKey.get("B")!.category).toBe("promising");
    expect(byKey.get("C")!.category).toBe("unproven");
    expect(byKey.get("D")!.category).toBe("losing");
  });

  it("does not call a setup proven when most trades have no valid R", () => {
    const trades = Array.from({ length: 30 }, (_, i) =>
      makeTrade({
        setupType: "sparse-R",
        rMultiple: i < 8 ? "1" : null,
        resultType: i < 8 ? "WIN" : "BREAKEVEN",
      })
    );
    const rank = computeSetupRanking(trades)[0];
    expect(rank.count).toBe(30);
    expect(rank.rSampleSize).toBe(8);
    expect(rank.decidedSampleSize).toBe(8);
    expect(rank.expectancy).toBe(1);
    expect(rank.category).toBe("unproven");
  });
});

describe("seasonality", () => {
  it("requires five valid R and five decided trades before issuing a verdict", () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      makeTrade({
        localEntryDate: "2026-01-15",
        localYear: 2026,
        localMonth: 1,
        localDayOfMonth: 15,
        localIsoWeek: 3,
        rMultiple: i < 3 ? "1" : null,
        resultType: i < 3 ? "WIN" : "BREAKEVEN",
      })
    );
    const cell = computeSeasonality(trades).months[0];
    expect(cell.count).toBe(5);
    expect(cell.rSampleSize).toBe(3);
    expect(cell.decidedSampleSize).toBe(3);
    expect(cell.verdict).toBe("insufficient");
  });
});

describe("sequences", () => {
  it("builds the transition matrix on alternating results", () => {
    const trades: AdvancedTrade[] = [];
    for (let i = 0; i < 10; i++) {
      trades.push(
        makeTrade({
          resultType: i % 2 === 0 ? "WIN" : "LOSS",
          rMultiple: i % 2 === 0 ? "1" : "-1",
          netPnl: i % 2 === 0 ? "100" : "-100",
          exitTime: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
        })
      );
    }
    const res = computeSequences(trades);
    expect(res.matrix.ww).toBe(0);
    expect(res.matrix.wl).toBe(5);
    expect(res.matrix.lw).toBe(4);
    expect(res.matrix.ll).toBe(0);
    expect(res.baselineWinRate).toBe(50);
  });
});

describe("anomalies", () => {
  it("flags a far R outlier and not the bulk", () => {
    const bulk = Array.from({ length: 20 }, () =>
      makeTrade({ rMultiple: "0.5", durationMin: 120 })
    );
    const outlier = makeTrade({ rMultiple: "8", durationMin: 120 });
    const res = computeAnomalies([...bulk, outlier]);
    expect(res.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(res.anomalies[0].tradeId).toBe(outlier.id);
    expect(res.anomalies[0].kind).toBe("R_OUTLIER");
    expect(res.anomalies[0].severity).toBe("high");
  });
});

describe("trader score", () => {
  it("measures monthly consistency in average R, not account-currency P&L", () => {
    const makeSet = (scale: number) => [
      makeTrade({ localDate: "2026-01-05", rMultiple: "1", netPnl: String(100 * scale) }),
      makeTrade({ localDate: "2026-01-15", rMultiple: "3", netPnl: String(300 * scale) }),
      makeTrade({ localDate: "2026-02-05", rMultiple: "0", netPnl: String(50 * scale), resultType: "BREAKEVEN" }),
      makeTrade({ localDate: "2026-02-15", rMultiple: "2", netPnl: String(200 * scale) }),
    ];
    const scoreFor = (trades: AdvancedTrade[]) => {
      const stats = computeTradeStats(trades);
      return computeTraderScore(trades, stats, computeAdvancedStats(trades, stats));
    };
    const normal = scoreFor(makeSet(1));
    const scaled = scoreFor(makeSet(100));
    expect(normal.details.monthlyRStd).not.toBeNull();
    expect(scaled.details.monthlyRStd).toBe(normal.details.monthlyRStd);
  });
  it("stays within 0-100 and rewards a clean, profitable run", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade({
        rMultiple: "1",
        resultType: "WIN",
        followedPlan: true,
        riskPercent: "1",
        localDate: `2026-0${1 + Math.floor(i / 10)}-${String(1 + (i % 10)).padStart(2, "0")}`,
      })
    );
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const score = computeTraderScore(trades, stats, advanced);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.components.discipline).toBeGreaterThan(20);
  });
});
