/**
 * Lot 11 (roadmap §14) - compliance vs result: average R per
 * playbook-match category.
 *
 * Analytics used to count MATCHED / PARTIAL / OFF_PLAYBOOK trades without
 * ever asking whether following the playbook actually pays. playbookMatchR
 * carries the average R of each category (null when the category has no
 * trade with a known R), so the quality view can show it next to the
 * counts. Counts and money stay separate: one lucky trade does not
 * become "the edge".
 */
import { describe, expect, it } from "vitest";
import {
  computeTradeReviewAnalytics,
  type AdvancedTrade,
} from "@/lib/analytics/advanced";

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

describe("playbookMatchR", () => {
  it("averages R per match category from reviewed trades only", () => {
    const result = computeTradeReviewAnalytics([
      makeTrade({
        rMultiple: "2",
        review: {
          followedPlan: true,
          planAdherenceScore: 5,
          executionQuality: 5,
          entryQuality: 5,
          exitQuality: 5,
          riskManagementScore: 5,
          emotionalControlScore: 5,
          wouldTakeAgain: "YES",
          mistakeTags: [],
        },
        playbookMatch: "MATCHED",
      }),
      makeTrade({
        rMultiple: "0",
        review: {
          followedPlan: true,
          planAdherenceScore: 5,
          executionQuality: 5,
          entryQuality: 5,
          exitQuality: 5,
          riskManagementScore: 5,
          emotionalControlScore: 5,
          wouldTakeAgain: "YES",
          mistakeTags: [],
        },
        playbookMatch: "MATCHED",
      }),
      makeTrade({
        rMultiple: "-1",
        review: {
          followedPlan: false,
          planAdherenceScore: 2,
          executionQuality: 2,
          entryQuality: 2,
          exitQuality: 2,
          riskManagementScore: 2,
          emotionalControlScore: 2,
          wouldTakeAgain: "NO",
          mistakeTags: [],
        },
        playbookMatch: "OFF_PLAYBOOK",
      }),
    ]);
    expect(result.playbookMatch.matched).toBe(2);
    expect(result.playbookMatch.offPlaybook).toBe(1);
    expect(result.playbookMatchR.matched).toBe(1);
    expect(result.playbookMatchR.partial).toBeNull();
    expect(result.playbookMatchR.offPlaybook).toBe(-1);
  });

  it("ignores trades without a review and trades without a known R", () => {
    const result = computeTradeReviewAnalytics([
      makeTrade({ rMultiple: "5", playbookMatch: null }),
      makeTrade({
        rMultiple: null,
        review: {
          followedPlan: true,
          planAdherenceScore: 5,
          executionQuality: 5,
          entryQuality: 5,
          exitQuality: 5,
          riskManagementScore: 5,
          emotionalControlScore: 5,
          wouldTakeAgain: "YES",
          mistakeTags: [],
        },
        playbookMatch: "PARTIAL",
      }),
    ]);
    expect(result.playbookMatch.partial).toBe(1);
    expect(result.playbookMatchR.partial).toBeNull();
    expect(result.playbookMatchR.matched).toBeNull();
  });
});
