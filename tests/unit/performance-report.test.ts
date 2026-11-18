/**
 * Performance report engine (MRT wave 3, work item 3) — unit tests.
 *
 * Pure functions only (no DB): weekly P&L grouping, edge sources, the
 * verdict / recommendations reuse of the weekly plan engine, coverage
 * and route wiring. Every asserted figure is built from the fabricated
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
  buildPerformanceReport,
  edgeSources,
  groupWeeklyPnl,
  weekMondayOf,
  type PerformanceReportInput,
} from "@/lib/analytics/performance-report";
import { parsePathname, routeToPath } from "@/lib/routes";

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
    confluenceTags: [],
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
): PerformanceReportInput {
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
    confluences: computed.confluences,
    weekStart: "2026-11-16",
    weekEnd: "2026-11-22",
    currency,
  };
}

describe("weekMondayOf", () => {
  it("returns the Monday of the week of a day", () => {
    // Tue 17 Nov 2026 -> Mon 16 Nov.
    expect(weekMondayOf("2026-11-17")).toBe("2026-11-16");
    // Sun 15 Nov 2026 -> Mon 9 Nov.
    expect(weekMondayOf("2026-11-15")).toBe("2026-11-09");
    // A Monday stays itself.
    expect(weekMondayOf("2026-11-16")).toBe("2026-11-16");
  });

  it("returns null for a malformed day", () => {
    expect(weekMondayOf("not-a-date")).toBeNull();
    expect(weekMondayOf("2026-13-40")).toBeNull();
  });
});

describe("groupWeeklyPnl", () => {
  it("groups trades by Monday-Sunday week with win rate and net P&L", () => {
    const trades = [
      makeTrade({
        localDate: "2026-11-02",
        localWeekday: 1,
        resultType: "WIN",
        netPnl: "100",
        rMultiple: "1",
      }),
      makeTrade({
        localDate: "2026-11-04",
        localWeekday: 3,
        resultType: "LOSS",
        netPnl: "-40",
        rMultiple: "-0.4",
      }),
      makeTrade({
        localDate: "2026-11-09",
        localWeekday: 1,
        resultType: "WIN",
        netPnl: "50",
        rMultiple: "0.5",
      }),
    ];
    const weeks = groupWeeklyPnl(trades);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({
      weekStart: "2026-11-02",
      weekEnd: "2026-11-08",
      trades: 2,
      wins: 1,
      winRate: 50,
      netPnl: "60",
    });
    expect(weeks[1]).toMatchObject({
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      trades: 1,
      wins: 1,
      winRate: 100,
      netPnl: "50",
    });
  });

  it("returns an empty list with no trades", () => {
    expect(groupWeeklyPnl([])).toEqual([]);
  });
});

describe("edgeSources", () => {
  it("finds the best session, setup and confluence", () => {
    const trades = [
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          session: "LONDON",
          setupType: "BOS",
          confluenceTags: [{ id: "c1", name: "FVG", color: "#10b981" }],
          resultType: "WIN",
          netPnl: "100",
          rMultiple: "1",
        })
      ),
      ...Array.from({ length: 5 }, () =>
        makeTrade({
          session: "NEW_YORK",
          setupType: "BOS",
          resultType: "LOSS",
          netPnl: "-100",
          rMultiple: "-1",
        })
      ),
    ];
    const input = buildInput(trades);
    const sources = edgeSources(trades, input.setups, input.confluences);
    const session = sources.find((s) => s.kind === "session");
    expect(session).toBeDefined();
    expect(session?.name).toBe("London");
    expect(session?.trades).toBe(5);
    expect(session?.expectancyR).toBe(1);
    // Confluence FVG: 5 trades, all wins, positive expectancy.
    const conf = sources.find((s) => s.kind === "confluence");
    expect(conf).toBeDefined();
    expect(conf?.name).toBe("FVG");
    expect(conf?.trades).toBe(5);
  });

  it("leaves out a source that clears no bar", () => {
    const trades = Array.from({ length: 6 }, () =>
      makeTrade({ resultType: "LOSS", netPnl: "-100", rMultiple: "-1" })
    );
    const input = buildInput(trades);
    // Every session loses, no setup is proven, no confluence is tagged.
    expect(edgeSources(trades, input.setups, input.confluences)).toEqual([]);
  });
});

describe("buildPerformanceReport — insufficient sample", () => {
  it("marks the report insufficient under five trades", () => {
    const trades = [makeTrade(), makeTrade(), makeTrade(), makeTrade()];
    const report = buildPerformanceReport(buildInput(trades));
    expect(report.sufficient).toBe(false);
    expect(report.sampleSize).toBe(4);
    expect(report.recommendations).toEqual([]);
    // No invented verdict: under 20 trades the edge is never "yes".
    expect(report.edge.verdict).not.toBe("yes");
    expect(report.coverage).toMatchObject({ trades: 4, accounts: 1 });
  });
});

describe("buildPerformanceReport — verdict and recommendations", () => {
  it("reuses the weekly plan engine: same verdict, same top actions", () => {
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
    const report = buildPerformanceReport(buildInput(trades));
    expect(report.sufficient).toBe(true);
    expect(report.sampleSize).toBe(10);
    // The worst-session leak is the first recommendation.
    expect(report.recommendations[0]?.rule).toBe("worst-session");
    expect(report.recommendations.length).toBeLessThanOrEqual(3);
    expect(report.costs.length).toBeGreaterThan(0);
    // Coverage counts the distinct accounts behind the trades.
    expect(report.coverage).toMatchObject({ trades: 10, accounts: 1 });
    // At a glance agrees with the raw stats: -250 net over 10 trades.
    expect(report.atAGlance.netPnl).toBe("-250");
    expect(report.atAGlance.trades).toBe(10);
    // Weekly P&L adds up to the same net.
    const weeklyNet = report.weeklyPnl.reduce(
      (acc, w) => acc + Number(w.netPnl),
      0
    );
    expect(weeklyNet).toBe(-250);
  });

  it("counts distinct accounts in the coverage", () => {
    const trades = [
      ...[2, 3, 4].map((day) =>
        makeTrade({
          accountId: "acc-1",
          accountName: "Main",
          localDate: `2026-11-0${day}`,
          entryTime: `2026-11-0${day}T10:00:00.000Z`,
          exitTime: `2026-11-0${day}T12:00:00.000Z`,
        })
      ),
      ...[5, 6, 7].map((day) =>
        makeTrade({
          accountId: "acc-2",
          accountName: "Prop",
          localDate: `2026-11-0${day}`,
          entryTime: `2026-11-0${day}T10:00:00.000Z`,
          exitTime: `2026-11-0${day}T12:00:00.000Z`,
        })
      ),
    ];
    const report = buildPerformanceReport(buildInput(trades));
    expect(report.coverage.accounts).toBe(2);
    expect(report.coverage.from).toBe("2026-11-02");
    expect(report.coverage.to).toBe("2026-11-07");
  });
});

describe("performance report — route wiring", () => {
  it("resolves /analytics/performance-report to the new view", () => {
    expect(parsePathname("/analytics/performance-report").view).toBe(
      "analytics-performance-report"
    );
    expect(
      routeToPath({ view: "analytics-performance-report" })
    ).toBe("/analytics/performance-report");
  });
});
