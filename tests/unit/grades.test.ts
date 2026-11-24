/**
 * Trade grades (MRT wave 3, chantier 1) — unit tests.
 *
 * Pure functions only (no DB): the grade value set, the by-grade
 * aggregation (win rate, P&L, average R, graded vs ungraded counts), the
 * validation schemas, and the clean route. Thresholds asserted here are
 * the ones documented in the UI (10 trades minimum).
 */
import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE_GRADE,
  computeAdvancedAnalytics,
  computeGrades,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";
import { computeTradeStats } from "@/lib/analytics/engine";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { parsePathname, routeToPath } from "@/lib/routes";
import {
  TRADE_GRADES,
  compareTradeGrades,
  isTradeGrade,
} from "@/lib/trading/grades";
import {
  tradeInputSchema,
  tradeListQuerySchema,
  tradePatchSchema,
} from "@/lib/validations/trade";

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
    grade: null,
    confluenceTags: [],
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

describe("TRADE_GRADES — the MRT scale, nothing else", () => {
  it("holds exactly A+, A, B and C, best first, with no D", () => {
    expect([...TRADE_GRADES]).toEqual(["A+", "A", "B", "C"]);
    expect(TRADE_GRADES).not.toContain("D");
  });

  it("recognises only the four grades, and orders A+ first, ungraded last", () => {
    expect(isTradeGrade("A+")).toBe(true);
    expect(isTradeGrade("C")).toBe(true);
    expect(isTradeGrade("D")).toBe(false);
    expect(isTradeGrade(null)).toBe(false);
    expect(isTradeGrade("")).toBe(false);
    expect(compareTradeGrades("A+", "A")).toBeLessThan(0);
    expect(compareTradeGrades("C", "B")).toBeGreaterThan(0);
    expect(compareTradeGrades(null, "C")).toBeGreaterThan(0);
    expect(compareTradeGrades("A+", "A+")).toBe(0);
  });

  it("uses the documented minimum sample of 10 trades", () => {
    expect(MIN_SAMPLE_GRADE).toBe(10);
  });
});

describe("computeGrades — win rate and P&L per grade", () => {
  it("returns honest zeros on an empty scope", () => {
    expect(computeGrades([])).toEqual({
      total: 0,
      graded: 0,
      ungraded: 0,
      rows: [],
    });
  });

  it("computes win rate, expectancy, total R and net P&L for one grade", () => {
    const trades = [
      makeTrade({ grade: "A+", resultType: "WIN", rMultiple: "2", netPnl: "200" }),
      makeTrade({ grade: "A+", resultType: "WIN", rMultiple: "1", netPnl: "100" }),
      makeTrade({ grade: "A+", resultType: "LOSS", rMultiple: "-1", netPnl: "-100" }),
      makeTrade({ grade: "A+", resultType: "BREAKEVEN", rMultiple: "0", netPnl: "0" }),
    ];
    const result = computeGrades(trades);
    expect(result.total).toBe(4);
    expect(result.graded).toBe(4);
    expect(result.ungraded).toBe(0);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.grade).toBe("A+");
    expect(row.count).toBe(4);
    expect(row.rSampleSize).toBe(4);
    expect(row.decidedSampleSize).toBe(3);
    expect(row.wins).toBe(2);
    expect(row.losses).toBe(1);
    expect(row.breakevens).toBe(1);
    // Win rate over decided trades only (2 wins / 3 decided).
    expect(row.winRate).toBeCloseTo(66.7, 1);
    expect(row.wilsonLower).not.toBeNull();
    expect(row.wilsonUpper).not.toBeNull();
    // Mean R over all four trades: (2 + 1 - 1 + 0) / 4.
    expect(row.expectancy).toBe(0.5);
    expect(row.avgR).toBe(0.5);
    expect(row.totalR).toBe(2);
    expect(row.netPnl).toBe("200");
  });

  it("counts ungraded trades, never assigns them a grade, and orders A+ first", () => {
    const trades = [
      makeTrade({ grade: "B", resultType: "WIN", rMultiple: "1", netPnl: "50" }),
      makeTrade({ grade: "A", resultType: "LOSS", rMultiple: "-1", netPnl: "-50" }),
      makeTrade({ grade: null, resultType: "WIN", rMultiple: "1", netPnl: "50" }),
      makeTrade({ grade: undefined, resultType: "LOSS", rMultiple: "-1", netPnl: "-50" }),
    ];
    const result = computeGrades(trades);
    expect(result.total).toBe(4);
    expect(result.graded).toBe(2);
    expect(result.ungraded).toBe(2);
    expect(result.rows.map((r) => r.grade)).toEqual(["A", "B"]);
    // Row counts add up to the graded total exactly (one grade per trade).
    expect(result.rows.reduce((a, r) => a + r.count, 0)).toBe(result.graded);
  });

  it("ignores trades without an R for expectancy, but counts them for win rate and P&L", () => {
    const trades = [
      makeTrade({ grade: "C", resultType: "WIN", rMultiple: null, netPnl: "80" }),
      makeTrade({ grade: "C", resultType: "LOSS", rMultiple: null, netPnl: "-30" }),
    ];
    const row = computeGrades(trades).rows[0];
    expect(row.count).toBe(2);
    expect(row.winRate).toBe(50);
    expect(row.expectancy).toBeNull();
    expect(row.avgR).toBeNull();
    expect(row.totalR).toBeNull();
    expect(row.netPnl).toBe("50");
  });

  it("is wired into the whole advanced payload", () => {
    const trades = [
      makeTrade({ grade: "A", resultType: "WIN", rMultiple: "1", netPnl: "100" }),
      makeTrade({ grade: null, resultType: "LOSS", rMultiple: "-1", netPnl: "-100" }),
    ];
    const stats = computeTradeStats(trades);
    const advanced = computeAdvancedStats(trades, stats);
    const payload = computeAdvancedAnalytics(trades, stats, advanced);
    expect(payload.grades.total).toBe(2);
    expect(payload.grades.graded).toBe(1);
    expect(payload.grades.ungraded).toBe(1);
    expect(payload.grades.rows.map((r) => r.grade)).toEqual(["A"]);
  });
});

describe("trade schemas — grade", () => {
  const baseInput = {
    accountId: "acc-1",
    instrumentId: "inst-1",
    direction: "LONG",
    entryTime: "2026-01-05T10:00:00.000Z",
    entryPrice: "2000",
    lots: "0.1",
  };

  it("accepts A+, A, B, C and null, and rejects D", () => {
    for (const grade of ["A+", "A", "B", "C", null]) {
      expect(
        tradeInputSchema.safeParse({ ...baseInput, grade }).success
      ).toBe(true);
    }
    expect(
      tradeInputSchema.safeParse({ ...baseInput, grade: "D" }).success
    ).toBe(false);
    // PATCH is partial: a grade-only patch parses. (Uses the exported
    // tradePatchSchema: Zod v4 forbids .partial() on the refined create
    // schema, and the patch schema is its canonical partial form.)
    expect(tradePatchSchema.safeParse({ grade: "A" }).success).toBe(true);
  });

  it("accepts a grade filter and UNGRADED, and rejects D", () => {
    expect(
      tradeListQuerySchema.safeParse({ grade: "A+" }).success
    ).toBe(true);
    expect(
      tradeListQuerySchema.safeParse({ grade: "UNGRADED" }).success
    ).toBe(true);
    expect(
      tradeListQuerySchema.safeParse({ grade: "D" }).success
    ).toBe(false);
  });
});

describe("routes — /analytics/grades", () => {
  it("parses and builds the grades tab path", () => {
    const route = parsePathname(
      "/analytics/grades",
      new URLSearchParams()
    );
    expect(route.view).toBe("analytics-grades");
    expect(routeToPath({ view: "analytics-grades" })).toBe(
      "/analytics/grades"
    );
  });

  it("keeps the grade drill-down query on the trades list", () => {
    const route = parsePathname(
      "/trades",
      new URLSearchParams("grade=A%2B")
    );
    expect(route.view).toBe("trades");
    expect(route.query?.grade).toBe("A+");
  });
});
