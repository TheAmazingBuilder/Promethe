import { describe, expect, it } from "vitest";
import {
  propChallengeInputSchema,
  propFirmRuleSetInputSchema,
  propPhaseResultInputSchema,
  propPayoutInputSchema,
} from "@/lib/validations/prop-firms";

const phase = {
  phase: "PHASE_1",
  profitTargetPercent: "8",
  maxDailyLossPercent: "5",
  maxTotalDrawdownPercent: "10",
  drawdownType: "STATIC",
  minTradingDays: 5,
  maxTradingDays: 30,
  consistencyRulePercent: null,
  newsTradingRestricted: false,
  weekendHoldingAllowed: false,
  leverage: "100",
};

describe("Prop Firm validation", () => {
  it("accepts a valid reusable rule set", () => {
    const result = propFirmRuleSetInputSchema.safeParse({
      name: "Two-step evaluation",
      firm: "Example Funding",
      phases: [phase, { ...phase, phase: "PHASE_2", profitTargetPercent: "5" }],
      resetTimeLocal: "00:00",
      timezone: "America/Toronto",
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate phases and impossible trading-day ranges", () => {
    expect(propFirmRuleSetInputSchema.safeParse({
      name: "Invalid",
      firm: "Example Funding",
      phases: [phase, phase],
      resetTimeLocal: "00:00",
      timezone: "UTC",
    }).success).toBe(false);

    expect(propFirmRuleSetInputSchema.safeParse({
      name: "Invalid",
      firm: "Example Funding",
      phases: [{ ...phase, minTradingDays: 20, maxTradingDays: 10 }],
      resetTimeLocal: "00:00",
      timezone: "UTC",
    }).success).toBe(false);
  });

  it("requires either a rule set or an explicit snapshot when creating a challenge", () => {
    const base = {
      accountId: "account_1",
      name: "100k Evaluation",
      firm: "Example Funding",
      accountSize: "100000",
      challengeFee: "99",
      feeCurrency: "USD",
      startDate: "2026-11-23",
    };
    expect(propChallengeInputSchema.safeParse(base).success).toBe(false);
    expect(propChallengeInputSchema.safeParse({ ...base, phases: [phase] }).success).toBe(true);
  });

  it("validates phase outcomes and keeps payout split within 0–100%", () => {
    expect(propPhaseResultInputSchema.safeParse({
      phase: "PHASE_1",
      result: "PASSED",
      tradingDaysCount: 12,
      startingBalance: "100000",
      endingBalance: "108000",
    }).success).toBe(true);

    expect(propPayoutInputSchema.safeParse({
      grossAmount: "1000",
      profitSplitPercent: 120,
      currency: "USD",
    }).success).toBe(false);
  });
});
