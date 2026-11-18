/**
 * Weekly improvement plan engine (MRT wave 1, chantier 1) — unit tests.
 *
 * Pure functions only (no DB): week helpers, rule generation, edge check,
 * route wiring and toggle validation. Every asserted figure is built from
 * the fabricated trades below, never from production data.
 */
import { describe, expect, it } from "vitest";
import {
  computeAdvancedAnalytics,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import {
  checkEdge,
  generateWeeklyPlan,
  weekEndSunday,
  weekStartMonday,
  type WeeklyPlanInput,
} from "@/lib/analytics/weekly-plan";
import { parsePathname, routeToPath } from "@/lib/routes";
import {
  weeklyPlanToggleSchema,
} from "@/lib/validations/analytics";

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

function buildInput(
  trades: AdvancedTrade[],
  currency = "USD"
): WeeklyPlanInput {
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
    currency,
  };
}

describe("week helpers", () => {
  it("returns the Monday of the week in the user timezone", () => {
    // Tue 17 Nov 2026 15:00 UTC = 10:00 EST in Toronto.
    expect(
      weekStartMonday(new Date("2026-11-17T15:00:00.000Z"), "America/Toronto")
    ).toBe("2026-11-16");
    // Sun 15 Nov 2026 -> Monday 9 Nov.
    expect(
      weekStartMonday(new Date("2026-11-15T15:00:00.000Z"), "America/Toronto")
    ).toBe("2026-11-09");
    // A Monday stays itself.
    expect(
      weekStartMonday(new Date("2026-11-16T15:00:00.000Z"), "America/Toronto")
    ).toBe("2026-11-16");
  });

  it("returns the Sunday of a Monday-start week", () => {
    expect(weekEndSunday("2026-11-16")).toBe("2026-11-22");
  });
});

describe("generateWeeklyPlan — insufficient sample", () => {
  it("generates no plan under five trades", () => {
    const trades = [
      makeTrade(),
      makeTrade(),
      makeTrade(),
      makeTrade(),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    expect(plan.sufficient).toBe(false);
    expect(plan.sampleSize).toBe(4);
    expect(plan.actions).toEqual([]);
    expect(plan.fixFirst).toBeNull();
    expect(plan.patterns).toEqual([]);
  });
});

describe("generateWeeklyPlan — rules", () => {
  it("flags the worst losing session as fix this first", () => {
    const trades = [
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          session: "LONDON",
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-1",
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          session: "NEW_YORK",
          resultType: "WIN",
          netPnl: "50",
          rMultiple: "0.5",
        })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    expect(plan.sufficient).toBe(true);
    const action = plan.actions.find((a) => a.rule === "worst-session");
    expect(action).toBeDefined();
    expect(action?.evidence.trades).toBe(5);
    expect(action?.evidence.netPnl).toContain("500");
    expect(plan.fixFirst?.rule).toBe("worst-session");
    expect(plan.fixFirst?.target).toContain("London");
  });

  it("flags the worst entry hours", () => {
    const trades = [
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          localHour: 15,
          resultType: "LOSS",
          netPnl: "-80",
          rMultiple: "-1",
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          localHour: 9,
          resultType: "WIN",
          netPnl: "60",
          rMultiple: "1",
        })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const action = plan.actions.find((a) => a.rule === "worst-hour");
    expect(action).toBeDefined();
    expect(action?.title).toContain("14:00");
    expect(action?.target).toContain("14:00");
  });

  it("flags trading right after a loss", () => {
    // Decided sequence (chronological by entryTime): six losses then a win.
    // The six trades after a loss average -0.5R.
    const trades = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({
          entryTime: `2026-11-${String(2 + i).padStart(2, "0")}T10:00:00.000Z`,
          exitTime: `2026-11-${String(2 + i).padStart(2, "0")}T12:00:00.000Z`,
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-1",
        })
      ),
      makeTrade({
        entryTime: "2026-11-09T10:00:00.000Z",
        exitTime: "2026-11-09T12:00:00.000Z",
        resultType: "WIN",
        netPnl: "200",
        rMultiple: "2",
      }),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const action = plan.actions.find((a) => a.rule === "after-loss");
    expect(action).toBeDefined();
    expect(action?.evidence.trades).toBe(6);
    expect(action?.evidence.avgR).toBe(-0.5);
  });

  it("flags trades that did not match the playbook", () => {
    const trades = [
      ...Array.from({ length: 3 }, () =>
        makeTrade({
          playbookMatch: "OFF_PLAYBOOK",
          resultType: "LOSS",
          netPnl: "-120",
          rMultiple: "-1",
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          playbookMatch: "MATCHED",
          resultType: "WIN",
          netPnl: "80",
          rMultiple: "1",
        })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const action = plan.actions.find((a) => a.rule === "off-playbook");
    expect(action).toBeDefined();
    expect(action?.evidence.trades).toBe(3);
  });

  it("flags losses deeper than -1R", () => {
    const trades = [
      makeTrade({ resultType: "LOSS", netPnl: "-250", rMultiple: "-2.5" }),
      makeTrade({ resultType: "LOSS", netPnl: "-150", rMultiple: "-1.5" }),
      ...Array.from({ length: 5 }, () =>
        makeTrade({ resultType: "WIN", netPnl: "100", rMultiple: "1" })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const action = plan.actions.find((a) => a.rule === "deep-losses");
    expect(action).toBeDefined();
    expect(action?.evidence.trades).toBe(2);
    expect(action?.evidence.label).toContain("2.00R");
    expect(action?.evidence.netPnl).toBe("-400");
  });

  it("flags a losing setup with at least ten trades", () => {
    const trades = [
      ...Array.from({ length: 12 }, () =>
        makeTrade({
          setupType: "BAD",
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-1",
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          setupType: "GOOD",
          resultType: "WIN",
          netPnl: "100",
          rMultiple: "1",
        })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    const action = plan.actions.find((a) => a.rule === "losing-setup");
    expect(action).toBeDefined();
    expect(action?.title).toContain("BAD");
    expect(action?.target).toContain("BAD");
  });

  it("never generates more than five actions", () => {
    const trades = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeTrade({
          setupType: "BAD",
          session: "LONDON",
          localHour: 15,
          localWeekday: 5,
          playbookMatch: "OFF_PLAYBOOK",
          followedPlan: false,
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-2",
          entryTime: `2026-11-${String(2 + (i % 10)).padStart(2, "0")}T15:00:00.000Z`,
          exitTime: `2026-11-${String(2 + (i % 10)).padStart(2, "0")}T17:00:00.000Z`,
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          setupType: "GOOD",
          session: "NEW_YORK",
          localHour: 9,
          resultType: "WIN",
          netPnl: "50",
          rMultiple: "1",
        })
      ),
    ];
    const plan = generateWeeklyPlan(buildInput(trades));
    expect(plan.actions.length).toBeLessThanOrEqual(5);
    expect(plan.actions.map((a) => a.rule)).toEqual(
      [...new Set(plan.actions.map((a) => a.rule))]
    );
    expect(plan.fixFirst).toBe(plan.actions[0]);
    expect(plan.actions[0].rank).toBe(1);
  });

  it("reuses the trader score instead of recomputing discipline", () => {
    const trades = [
      ...Array.from({ length: 6 }, () =>
        makeTrade({
          followedPlan: false,
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-1",
        })
      ),
      ...Array.from({ length: 6 }, () =>
        makeTrade({
          followedPlan: true,
          resultType: "WIN",
          netPnl: "100",
          rMultiple: "1",
        })
      ),
    ];
    const input = buildInput(trades);
    const plan = generateWeeklyPlan(input);
    expect(plan.disciplineScore).toBe(input.score.total);
    expect(plan.scoreComponents).toEqual(input.score.components);
  });
});

describe("checkEdge", () => {
  it("says yes with positive expectancy and a tight range", () => {
    const trades = Array.from({ length: 30 }, () =>
      makeTrade({ resultType: "WIN", netPnl: "100", rMultiple: "1" })
    );
    const input = buildInput(trades);
    const edge = checkEdge(trades, input.stats, input.advanced);
    expect(edge.verdict).toBe("yes");
    expect(edge.sampleSize).toBe(30);
    expect(edge.expectancyR).toBe(1);
  });

  it("says not yet under twenty trades", () => {
    const trades = Array.from({ length: 10 }, () =>
      makeTrade({ resultType: "WIN", netPnl: "100", rMultiple: "1" })
    );
    const input = buildInput(trades);
    const edge = checkEdge(trades, input.stats, input.advanced);
    expect(edge.verdict).toBe("not-yet");
  });

  it("says no with negative expectancy", () => {
    const trades = Array.from({ length: 30 }, () =>
      makeTrade({ resultType: "LOSS", netPnl: "-100", rMultiple: "-1" })
    );
    const input = buildInput(trades);
    const edge = checkEdge(trades, input.stats, input.advanced);
    expect(edge.verdict).toBe("no");
    expect(edge.expectancyR).toBe(-1);
  });
});

describe("weekly plan routes", () => {
  it("parses /analytics/weekly-plan and round-trips it", () => {
    expect(parsePathname("/analytics/weekly-plan").view).toBe(
      "analytics-weekly-plan"
    );
    expect(routeToPath({ view: "analytics-weekly-plan" })).toBe(
      "/analytics/weekly-plan"
    );
  });
});

describe("weeklyPlanToggleSchema", () => {
  it("accepts a known rule and a boolean", () => {
    expect(
      weeklyPlanToggleSchema.safeParse({ rule: "worst-hour", done: true })
        .success
    ).toBe(true);
  });

  it("rejects an unknown rule", () => {
    expect(
      weeklyPlanToggleSchema.safeParse({ rule: "nope", done: true }).success
    ).toBe(false);
    expect(
      weeklyPlanToggleSchema.safeParse({ rule: "worst-hour" }).success
    ).toBe(false);
  });
});
