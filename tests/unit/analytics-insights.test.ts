/**
 * Unit tests — analytics insights engine (v2 Phase 4).
 *
 * Hand-computed fixtures over small trade sets: advanced stats (SQN, Sharpe,
 * Sortino, payoff, recovery), R distribution buckets, breakdown dimensions
 * and insight rules (dimension extremes, discipline, revenge window,
 * overtrading, fees, streaks, R coverage).
 */
import { describe, expect, it } from "vitest";
import { computeTradeStats } from "@/lib/analytics/engine";
import {
  computeAdvancedStats,
  computeBreakdowns,
  computeInsights,
  computeRDistribution,
  weekdayOfIsoDate,
  type AnalyticsTrade,
} from "@/lib/analytics/insights";

let seq = 0;

/** Minimal AnalyticsTrade factory — sensible defaults, overridable. */
function trade(over: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  seq += 1;
  const n = String(seq).padStart(3, "0");
  return {
    id: `t${n}`,
    exitTime: `2026-01-${(Number(n) % 28) + 1 < 10 ? "0" : ""}${(Number(n) % 28) + 1}T14:00:00.000Z`,
    entryTime: `2026-01-${(Number(n) % 28) + 1 < 10 ? "0" : ""}${(Number(n) % 28) + 1}T10:00:00.000Z`,
    netPnl: "100",
    rMultiple: "1",
    resultType: "WIN",
    strategyId: "s1",
    strategyName: "Breakout",
    instrumentId: "i1",
    symbol: "XAUUSD",
    direction: "LONG",
    session: "LONDON",
    lots: "0.5",
    accountId: "a1",
    accountName: "Main",
    timeframe: "M15",
    setupType: null,
    marketCondition: null,
    exitReason: null,
    emotionBefore: null,
    followedPlan: null,
    commission: null,
    swap: null,
    fees: null,
    localDate: null,
    localEntryDate: null,
    localWeekday: null,
    localHour: null,
    durationMin: 240,
    ...over,
  };
}

describe("weekdayOfIsoDate", () => {
  it("2026-01-01 is a Thursday (4)", () => {
    expect(weekdayOfIsoDate("2026-01-01")).toBe(4);
  });
  it("2026-01-05 is a Monday (1)", () => {
    expect(weekdayOfIsoDate("2026-01-05")).toBe(1);
  });
  it("2026-01-04 is a Sunday (7)", () => {
    expect(weekdayOfIsoDate("2026-01-04")).toBe(7);
  });
});

describe("computeAdvancedStats", () => {
  it("SQN = √N · mean(R) / std(R) — 4 trades R = [1, 2, 3, 2]", () => {
    const trades = [
      trade({ rMultiple: "1" }),
      trade({ rMultiple: "2" }),
      trade({ rMultiple: "3" }),
      trade({ rMultiple: "2" }),
    ];
    const stats = computeTradeStats(trades);
    const adv = computeAdvancedStats(trades, stats);
    // mean = 2, population std = sqrt(0.5) → √4 · 2 / √0.5 ≈ 5.657
    expect(adv.sqn).not.toBeNull();
    expect(Number(adv.sqn)).toBeCloseTo(5.6568, 3);
  });

  it("uses R-aware outcomes and excludes breakevens from win-rate denominator", () => {
    const trades = [
      trade({ netPnl: "25", rMultiple: "0.05", resultType: "BREAKEVEN" }),
      trade({ netPnl: "-15", rMultiple: "-0.05", resultType: "BREAKEVEN" }),
      trade({ netPnl: "100", rMultiple: "1", resultType: "WIN" }),
      trade({ netPnl: "-50", rMultiple: "-1", resultType: "LOSS" }),
    ];
    const stats = computeTradeStats(trades);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.breakevens).toBe(2);
    expect(stats.winRate).toBe("50");
    // Cash-based metrics still include the actual P&L of BE-classified trades.
    expect(stats.grossWin).toBe("125");
    expect(stats.grossLoss).toBe("65");
  });

  it("falls back to P&L sign when historical trades have no resultType", () => {
    const trades = [
      trade({ netPnl: "10", resultType: null }),
      trade({ netPnl: "-10", resultType: null }),
      trade({ netPnl: "0", resultType: null }),
    ];
    const stats = computeTradeStats(trades);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.breakevens).toBe(1);
    expect(stats.winRate).toBe("50");
  });
  it("payoff ratio = avgWin / avgLoss", () => {
    const trades = [
      trade({ netPnl: "300", rMultiple: "2", resultType: "WIN" }),
      trade({ netPnl: "150", rMultiple: "1", resultType: "WIN" }),
      trade({ netPnl: "-100", rMultiple: "-1", resultType: "LOSS" }),
      trade({ netPnl: "-200", rMultiple: "-2", resultType: "LOSS" }),
    ];
    const stats = computeTradeStats(trades);
    const adv = computeAdvancedStats(trades, stats);
    // avgWin = 225, avgLoss = 150 → 1.5
    expect(adv.payoffRatio).toBe("1.5");
  });

  it("recovery factor = netPnl / maxDrawdown when both positive", () => {
    const trades = [
      trade({ netPnl: "500", rMultiple: "2", resultType: "WIN" }),
      trade({ netPnl: "-200", rMultiple: "-1", resultType: "LOSS" }),
      trade({ netPnl: "400", rMultiple: "2", resultType: "WIN" }),
    ];
    const stats = computeTradeStats(trades);
    const adv = computeAdvancedStats(trades, stats);
    // cum curve: 500, 300, 700 → maxDD = 200, net = 700 → rf = 3.5
    expect(adv.recoveryFactor).toBe("3.5");
    expect(adv.avgDurationMin).toBe(240);
  });

  it("total fees sum commission + swap + fees; rCoverage counts R trades", () => {
    const trades = [
      trade({ commission: "2.5", swap: "0.5", fees: "1" }),
      trade({ commission: "2.5", rMultiple: null }),
      trade({ commission: "2.5", rMultiple: null }),
      trade({ commission: "2.5", rMultiple: null }),
    ];
    const stats = computeTradeStats(trades);
    const adv = computeAdvancedStats(trades, stats);
    expect(adv.totalFees).toBe("11.5");
    // 1 of 4 trades has R → 25%
    expect(Number(adv.rCoverage)).toBe(25);
  });

  it("does not derive Sharpe or Sortino from monetary daily P&L", () => {
    const multi = [
      trade({ localDate: "2026-01-01", netPnl: "100" }),
      trade({ localDate: "2026-01-02", netPnl: "-50" }),
      trade({ localDate: "2026-01-03", netPnl: "200" }),
      trade({ localDate: "2026-01-04", netPnl: "150" }),
    ];
    const adv = computeAdvancedStats(multi, computeTradeStats(multi));
    // A daily P&L series is not a return series: account size and cash flows
    // are required before these ratios can be calculated defensibly.
    expect(adv.sharpe).toBeNull();
    expect(adv.sortino).toBeNull();
  });
});

describe("computeRDistribution", () => {
  it("buckets R values with inclusive-from / exclusive-to", () => {
    const trades = [
      trade({ rMultiple: "-4" }),
      trade({ rMultiple: "-3" }), // edge: -3 goes to [-3,-2)
      trade({ rMultiple: "-1.5" }),
      trade({ rMultiple: "0" }),
      trade({ rMultiple: "0.9" }),
      trade({ rMultiple: "1" }), // edge: 1 goes to [1,2)
      trade({ rMultiple: "2.5" }),
      trade({ rMultiple: "5" }),
      trade({ rMultiple: null }),
    ];
    const { buckets, withoutR } = computeRDistribution(trades);
    const byId = Object.fromEntries(buckets.map((b) => [b.id, b.count]));
    expect(byId).toEqual({
      "le-3": 1,
      m3m2: 1,
      m2m1: 1,
      m10: 0,
      "01": 2,
      "12": 1,
      "23": 1,
      ge3: 1,
    });
    expect(withoutR).toBe(1);
    // Totals are conserved.
    const total = buckets.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(8);
  });
});

describe("computeBreakdowns", () => {
  it("groups by plan followed (yes/no) and hour buckets of 2", () => {
    const trades = [
      trade({ followedPlan: true, localHour: 7 }),
      trade({ followedPlan: true, localHour: 8 }),
      trade({ followedPlan: false, localHour: 9 }),
    ];
    const bd = computeBreakdowns(trades);
    expect(bd.plan.map((g) => g.key).sort()).toEqual(["no", "yes"]);
    expect(bd.plan.find((g) => g.key === "yes")!.stats.tradeCount).toBe(2);
    // hours 7, 8, 9 → buckets 6, 8, 8
    expect(bd.hour.find((g) => g.key === "8")!.stats.tradeCount).toBe(2);
    expect(bd.hour.find((g) => g.key === "6")!.stats.tradeCount).toBe(1);
  });

  it("skips null dimensions and sorts by net P&L desc", () => {
    const trades = [
      trade({ strategyName: "A", netPnl: "100" }),
      trade({ strategyName: "B", netPnl: "500" }),
      trade({ strategyName: null, netPnl: "-50" }),
    ];
    const bd = computeBreakdowns(trades);
    expect(bd.strategy.map((g) => g.key)).toEqual(["B", "A"]);
  });
});

describe("computeInsights", () => {
  function full(trades: AnalyticsTrade[]) {
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const breakdowns = computeBreakdowns(trades);
    return { stats, advanced, breakdowns, insights: computeInsights(trades, breakdowns, stats, advanced) };
  }

  it("flags best/worst strategy with ≥ 3 trades per side", () => {
    const trades = [
      trade({ strategyName: "Good", netPnl: "200", rMultiple: "2" }),
      trade({ strategyName: "Good", netPnl: "150", rMultiple: "1" }),
      trade({ strategyName: "Good", netPnl: "100", rMultiple: "1" }),
      trade({ strategyName: "Bad", netPnl: "-120", rMultiple: "-1" }),
      trade({ strategyName: "Bad", netPnl: "-80", rMultiple: "-1" }),
      trade({ strategyName: "Bad", netPnl: "-100", rMultiple: "-1" }),
      // Strategy with too few trades — must NOT create an insight.
      trade({ strategyName: "Tiny", netPnl: "-1000", rMultiple: "-5" }),
    ];
    const { insights } = full(trades);
    const best = insights.find((i) => i.rule === "bestStrategy");
    const worst = insights.find((i) => i.rule === "worstStrategy");
    expect(best?.tone).toBe("good");
    expect(best?.params.name).toBe("Good");
    expect(worst?.tone).toBe("bad");
    expect(worst?.params.name).toBe("Bad");
    // "Tiny" never appears as an insight.
    expect(insights.every((i) => i.params.name !== "Tiny")).toBe(true);
  });

  it("disciplinePays when following the plan beats deviating by ≥ 0.3R", () => {
    const trades = [
      trade({ followedPlan: true, rMultiple: "1.5" }),
      trade({ followedPlan: true, rMultiple: "1.2" }),
      trade({ followedPlan: true, rMultiple: "1.0" }),
      trade({ followedPlan: false, rMultiple: "-0.5" }),
      trade({ followedPlan: false, rMultiple: "-0.4" }),
      trade({ followedPlan: false, rMultiple: "-0.3" }),
    ];
    const { insights } = full(trades);
    const d = insights.find((i) => i.rule === "disciplinePays");
    expect(d?.tone).toBe("good");
    expect(d?.params.nPlan).toBe(3);
    expect(d?.params.nNoPlan).toBe(3);
    // No planHurts simultaneously.
    expect(insights.find((i) => i.rule === "planHurts")).toBeUndefined();
  });

  it("revenge: re-entries within 24h after a ≥ 2R loss, negative average", () => {
    const trades = [
      // Big loss closes on Jan 5.
      trade({
        id: "big",
        entryTime: "2026-01-05T08:00:00.000Z",
        exitTime: "2026-01-05T10:00:00.000Z",
        rMultiple: "-2.5",
        netPnl: "-500",
        resultType: "LOSS",
      }),
      // Revenge entries within 24h, all small losers.
      trade({ entryTime: "2026-01-05T12:00:00.000Z", exitTime: "2026-01-05T14:00:00.000Z", rMultiple: "-0.4", netPnl: "-80", resultType: "LOSS" }),
      trade({ entryTime: "2026-01-06T02:00:00.000Z", exitTime: "2026-01-06T06:00:00.000Z", rMultiple: "-0.5", netPnl: "-90", resultType: "LOSS" }),
      trade({ entryTime: "2026-01-06T05:00:00.000Z", exitTime: "2026-01-06T09:00:00.000Z", rMultiple: "-0.3", netPnl: "-70", resultType: "LOSS" }),
    ];
    const { insights } = full(trades);
    const revenge = insights.find((i) => i.rule === "revenge");
    expect(revenge?.tone).toBe("bad");
    expect(revenge?.params.count).toBe(3);
  });

  it("no revenge insight when re-entries happen after 24h", () => {
    const trades = [
      trade({
        entryTime: "2026-01-05T08:00:00.000Z",
        exitTime: "2026-01-05T10:00:00.000Z",
        rMultiple: "-2.5",
        netPnl: "-500",
        resultType: "LOSS",
      }),
      trade({ entryTime: "2026-01-08T08:00:00.000Z", exitTime: "2026-01-08T12:00:00.000Z", rMultiple: "-0.4", netPnl: "-80", resultType: "LOSS" }),
      trade({ entryTime: "2026-01-09T08:00:00.000Z", exitTime: "2026-01-09T12:00:00.000Z", rMultiple: "-0.5", netPnl: "-90", resultType: "LOSS" }),
      trade({ entryTime: "2026-01-10T08:00:00.000Z", exitTime: "2026-01-10T12:00:00.000Z", rMultiple: "-0.3", netPnl: "-70", resultType: "LOSS" }),
    ];
    const { insights } = full(trades);
    expect(insights.find((i) => i.rule === "revenge")).toBeUndefined();
  });

  it("overtrading: busy entry days underperform light entry days", () => {
    const mk = (i: number, day: string) =>
      trade({
        entryTime: `2026-01-${day}T0${i}:00:00.000Z`,
        exitTime: `2026-01-20T1${i}:00:00.000Z`,
        localEntryDate: `2026-01-${day}`,
        // Every trade closes on the same day: frequency must still follow entry.
        localDate: "2026-01-20",
        rMultiple: "-0.2",
        netPnl: "-20",
        resultType: "LOSS",
      });
    // Two busy ENTRY days (5 trades each) at -0.2R average…
    const trades = [
      ...Array.from({ length: 5 }, (_, i) => mk(i, "05")),
      ...Array.from({ length: 5 }, (_, i) => mk(i, "06")),
      // …and two light entry days at +1R.
      trade({ entryTime: "2026-01-10T08:00:00.000Z", exitTime: "2026-01-20T12:00:00.000Z", localEntryDate: "2026-01-10", localDate: "2026-01-20", rMultiple: "1", netPnl: "100", resultType: "WIN" }),
      trade({ entryTime: "2026-01-11T08:00:00.000Z", exitTime: "2026-01-20T13:00:00.000Z", localEntryDate: "2026-01-11", localDate: "2026-01-20", rMultiple: "1", netPnl: "100", resultType: "WIN" }),
    ];
    const { insights } = full(trades);
    const ot = insights.find((i) => i.rule === "overtrading");
    expect(ot?.tone).toBe("bad");
    expect(ot?.params.busyDays).toBe(2);
    expect(ot?.params.busyTrades).toBe(10);
  });

  it("feesDrag when fees ≥ 10% of gross win; rCoverage when < 70%", () => {
    const trades = [
      trade({ netPnl: "500", rMultiple: "2", resultType: "WIN", commission: "30", swap: "10" }),
      trade({ netPnl: "400", rMultiple: "1", resultType: "WIN" }),
      trade({ netPnl: "-100", rMultiple: "-1", resultType: "LOSS" }),
      trade({ netPnl: "0", rMultiple: null, resultType: "BREAKEVEN" }),
    ];
    const { insights } = full(trades);
    // fees = 40, grossWin = 900 → 4.4% — NO fee insight.
    expect(insights.find((i) => i.rule === "feesDrag")).toBeUndefined();
    // 3 of 4 trades have R → 75% — no coverage warning.
    expect(insights.find((i) => i.rule === "rCoverage")).toBeUndefined();

    const heavy = [
      trade({ netPnl: "500", rMultiple: "2", resultType: "WIN", commission: "60", swap: "40" }),
      trade({ netPnl: "-100", rMultiple: "-1", resultType: "LOSS" }),
      trade({ netPnl: "0", rMultiple: null, resultType: "BREAKEVEN" }),
      trade({ netPnl: "0", rMultiple: null, resultType: "BREAKEVEN" }),
    ];
    const heavyResult = full(heavy);
    // fees = 100, grossWin = 500 → 20%
    expect(heavyResult.insights.find((i) => i.rule === "feesDrag")).toBeDefined();
    // 2 of 4 → 50%
    expect(heavyResult.insights.find((i) => i.rule === "rCoverage")).toBeDefined();
  });

  it("lossStreak warning at ≥ 5 consecutive losses", () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      trade({
        entryTime: `2026-01-0${i + 1}T08:00:00.000Z`,
        exitTime: `2026-01-0${i + 1}T12:00:00.000Z`,
        rMultiple: "-1",
        netPnl: "-100",
        resultType: "LOSS",
      })
    );
    const { insights } = full(trades);
    const ls = insights.find((i) => i.rule === "lossStreak");
    expect(ls?.params.count).toBe(5);
  });

  it("emotionWorst for a losing pre-entry emotion (≥ 3 trades, ≤ -0.3R)", () => {
    const trades = [
      trade({ emotionBefore: "CALM", rMultiple: "1", netPnl: "100", resultType: "WIN" }),
      trade({ emotionBefore: "CALM", rMultiple: "0.8", netPnl: "80", resultType: "WIN" }),
      trade({ emotionBefore: "CALM", rMultiple: "0.9", netPnl: "90", resultType: "WIN" }),
      trade({ emotionBefore: "FOMO", rMultiple: "-0.8", netPnl: "-80", resultType: "LOSS" }),
      trade({ emotionBefore: "FOMO", rMultiple: "-0.6", netPnl: "-60", resultType: "LOSS" }),
      trade({ emotionBefore: "FOMO", rMultiple: "-0.9", netPnl: "-90", resultType: "LOSS" }),
    ];
    const { insights } = full(trades);
    const e = insights.find((i) => i.rule === "emotionWorst");
    expect(e?.params.emotion).toBe("FOMO");
    expect(e?.tone).toBe("bad");
  });

  it("empty input → no insights, no crash", () => {
    const { insights, stats } = full([]);
    expect(insights).toEqual([]);
    expect(stats.tradeCount).toBe(0);
  });
});
