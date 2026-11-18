/**
 * Top 3 leaks widget (MRT wave 2, chantier 2) — unit tests.
 *
 * Pure functions only (no DB): the drill-down links the weekly plan
 * engine attaches to its actions, and the end-to-end wiring through
 * generateWeeklyPlan. Every asserted figure is built from the fabricated
 * trades below, never from production data.
 */
import { describe, expect, it } from "vitest";
import {
  computeAdvancedAnalytics,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import {
  generateWeeklyPlan,
  planActionDrilldown,
  type WeeklyPlanInput,
} from "@/lib/analytics/weekly-plan";

let seq = 0;

function makeTrade(partial: Partial<AdvancedTrade> = {}): AdvancedTrade {
  seq += 1;
  const day = String(1 + (seq % 27)).padStart(2, "0");
  const base: AdvancedTrade = {
    id: `trade-${seq}`,
    exitTime: `2026-11-${day}T12:00:00.000Z`,
    entryTime: `2026-11-${day}T10:00:00.000Z`,
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
    localDate: `2026-11-${day}`,
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
    playbookMatch: null,
    riskPercent: "1",
    setupQualityRating: 4,
    localYear: 2026,
    localMonth: 11,
    localDayOfMonth: Number(day),
    localIsoWeek: 46,
    localEntryDate: `2026-11-${day}`,
    timeInProfitMin: null,
    timeInLossMin: null,
  };
  return { ...base, ...partial };
}

function buildInput(trades: AdvancedTrade[]): WeeklyPlanInput {
  const stats = computeTradeStats(trades);
  const advanced = computeAdvancedStats(trades, stats);
  const computed = computeAdvancedAnalytics(trades, stats, advanced);
  return {
    trades,
    stats,
    advanced,
    score: computed.score,
    setups: computed.setups,
    sequences: computed.sequences,
    weekStart: "2026-11-16",
    weekEnd: "2026-11-22",
    currency: "USD",
  };
}

describe("planActionDrilldown", () => {
  it("links a worst-session leak to the filtered trades list", () => {
    expect(
      planActionDrilldown("worst-session", { session: "LONDON" })
    ).toEqual({ href: "/trades?session=LONDON" });
  });

  it("links a worst-weekday leak to the filtered trades list", () => {
    expect(planActionDrilldown("worst-weekday", { weekday: 3 })).toEqual({
      href: "/trades?entryWeekday=3",
    });
  });

  it("returns null when the session or weekday is missing", () => {
    expect(planActionDrilldown("worst-session", {})).toBeNull();
    expect(planActionDrilldown("worst-session", { session: null })).toBeNull();
    expect(planActionDrilldown("worst-weekday", {})).toBeNull();
  });

  it("returns null for rules with no exact trades filter", () => {
    expect(
      planActionDrilldown("worst-hour", { session: "LONDON", weekday: 3 })
    ).toBeNull();
    expect(planActionDrilldown("after-loss", {})).toBeNull();
    expect(planActionDrilldown("off-playbook", {})).toBeNull();
    expect(planActionDrilldown("deep-losses", {})).toBeNull();
    expect(planActionDrilldown("losing-setup", {})).toBeNull();
    expect(planActionDrilldown("discipline", {})).toBeNull();
  });
});

describe("generateWeeklyPlan — leak drill-downs", () => {
  it("attaches exact trades links to the session and weekday leaks", () => {
    const trades = [
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    expect(plan.sufficient).toBe(true);

    const sessionAction = plan.actions.find(
      (a) => a.rule === "worst-session"
    );
    expect(sessionAction?.drilldown).toEqual({
      href: "/trades?session=LONDON",
    });

    const weekdayAction = plan.actions.find(
      (a) => a.rule === "worst-weekday"
    );
    expect(weekdayAction?.drilldown).toEqual({
      href: "/trades?entryWeekday=3",
    });
  });

  it("leaves the top 3 leaks ordered by money lost", () => {
    const trades = [
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "LONDON",
        localWeekday: 3,
        netPnl: "-100",
        rMultiple: "-1",
        resultType: "LOSS",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
      makeTrade({
        session: "ASIAN",
        localWeekday: 1,
        netPnl: "100",
        rMultiple: "1",
        resultType: "WIN",
      }),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const top3 = plan.actions.slice(0, 3);
    expect(top3.length).toBeGreaterThan(0);
    expect(top3[0].rule).toBe("worst-session");
    expect(top3[0].rank).toBe(1);
    expect(plan.fixFirst).toBe(plan.actions[0]);
  });
});
