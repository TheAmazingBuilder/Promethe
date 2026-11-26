/**
 * Lot 5 — Prop Firm engine, server side (PostgreSQL schema promethe_test).
 *
 * The engine is pure (see tests/unit/prop-engine.test.ts); this file proves
 * the server wiring: the challenge's frozen rules and frozen day boundary
 * drive the evaluation, one challenge never sees another challenge's or
 * another user's trades, the dashboard PROP status uses the engine when a
 * challenge exists and keeps the legacy Account fields otherwise, and
 * payouts/expenses can be corrected or removed only by their owner.
 *
 * Seeds use dates relative to "now" so the phase windows stay meaningful
 * whenever the suite runs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name)
        ? { name, value: cookieStore.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createSession } from "@/server/session";
import { getPropStatus } from "@/server/prop-status";
import { getPropChallengeEvaluation } from "@/server/prop-evaluation";
import {
  createPropChallenge,
  createPropExpense,
  createPropFirmRuleSet,
  createPropPayout,
  createPropPhaseResult,
  deletePropExpense,
  deletePropPayout,
  listPropFirmWorkspace,
  updatePropChallenge,
  updatePropExpense,
  updatePropFirmRuleSet,
  updatePropPayout,
} from "@/server/prop-firms";
import { GET as getEvaluation } from "@/app/api/prop-firms/challenges/[id]/evaluation/route";
import type { PropPhaseRuleInput } from "@/lib/validations/prop-firms";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Gold / US Dollar",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.10",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: "0.01",
  isActive: true,
};

const now = new Date();
const daysAgo = (n: number) =>
  new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - n,
      12,
      0,
      0,
    ),
  );
const isoDayOf = (d: Date) => d.toISOString().slice(0, 10);

let instrumentId: string;
let userA: { id: string };
let userB: { id: string };
let userC: { id: string };
let userD: { id: string };
let userE: { id: string };
let accountA1Id: string;
let accountA2Id: string;
let accountA3Id: string;
let accountBId: string;
let accountCId: string;
let accountDId: string;
let accountEId: string;
let ruleSetAId: string;
let challengeAId: string;
let challengeA2Id: string;
let challengeBId: string;
let challengeCId: string;
let challengeDId: string;
let challengeEId: string;

function phaseRule(
  overrides: Partial<PropPhaseRuleInput> = {},
): PropPhaseRuleInput {
  return {
    phase: "PHASE_1",
    profitTargetPercent: "10",
    maxDailyLossPercent: "5",
    maxTotalDrawdownPercent: "10",
    drawdownType: "STATIC",
    minTradingDays: 5,
    maxTradingDays: 30,
    consistencyRulePercent: null,
    newsTradingRestricted: false,
    weekendHoldingAllowed: true,
    leverage: null,
    ...overrides,
  };
}

async function makePropAccount(
  userId: string,
  name: string,
  legacy: {
    maxDailyLossPercent?: string;
    maxTotalDrawdownPercent?: string;
    profitTarget?: string;
    drawdownType?: string;
  } = {},
) {
  const account = await db.account.create({
    data: {
      userId,
      name,
      type: "PROP",
      currency: "USD",
      initialBalance: "100000",
      ...legacy,
    },
  });
  return account.id;
}

async function seedClosedTrade(
  userId: string,
  accountId: string,
  exit: Date,
  netPnl: string,
) {
  await db.trade.create({
    data: {
      userId,
      accountId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: new Date(exit.getTime() - 2 * 60 * 60 * 1000),
      exitTime: exit,
      entryPrice: "2000",
      exitPrice: "2010",
      lots: "1",
      netPnl,
      pnlCurrency: "USD",
      rMultiple: "1",
      resultType: Number(netPnl) >= 0 ? "WIN" : "LOSS",
      followedPlan: true,
      riskPercent: "1",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
}

async function loginAs(userId: string) {
  cookieStore.clear();
  await createSession(userId);
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeAll(async () => {
  const existing = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  const instrument =
    existing ??
    (await db.instrument.create({
      data: { userId: null, ...XAUUSD_SPEC },
    }));
  instrumentId = instrument.id;

  const startDay = isoDayOf(daysAgo(30));

  // ── User A: challenge 1 passes (5 x +2500), challenge 2 breaches ──
  const a = await createUserWithDefaults({
    email: "prop-a@test.local",
    password: "test-password-123",
    displayName: "Prop A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  accountA1Id = await makePropAccount(userA.id, "Prop A1", {
    maxDailyLossPercent: "2",
    maxTotalDrawdownPercent: "4",
    profitTarget: "5000",
    drawdownType: "STATIC",
  });
  accountA2Id = await makePropAccount(userA.id, "Prop A2");
  accountA3Id = await makePropAccount(userA.id, "Prop A3 legacy", {
    maxDailyLossPercent: "2",
    maxTotalDrawdownPercent: "4",
    profitTarget: "5000",
    drawdownType: "STATIC",
  });
  const ruleSetA = await createPropFirmRuleSet(userA.id, {
    name: "TestFirm 10k",
    firm: "TestFirm",
    phases: [phaseRule()],
    resetTimeLocal: "22:00",
    timezone: "Europe/Paris",
    notes: null,
  });
  ruleSetAId = ruleSetA.id;
  const challengeA = await createPropChallenge(userA.id, {
    accountId: accountA1Id,
    ruleSetId: ruleSetAId,
    name: "Challenge A",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "500",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeAId = challengeA!.id;
  const challengeA2 = await createPropChallenge(userA.id, {
    accountId: accountA2Id,
    ruleSetId: ruleSetAId,
    name: "Challenge A2",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "500",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeA2Id = challengeA2!.id;
  for (const age of [2, 3, 4, 5, 6]) {
    await seedClosedTrade(userA.id, accountA1Id, daysAgo(age), "2500");
  }
  await seedClosedTrade(userA.id, accountA2Id, daysAgo(2), "-6000");
  await seedClosedTrade(userA.id, accountA3Id, daysAgo(2), "-1000");
  await db.cashTransaction.create({
    data: {
      userId: userA.id,
      accountId: accountA1Id,
      type: "DEPOSIT",
      amount: "20000",
      date: daysAgo(4),
    },
  });

  // ── User B: own challenge, own losing trade ──
  const b = await createUserWithDefaults({
    email: "prop-b@test.local",
    password: "test-password-123",
    displayName: "Prop B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userB = b.user;
  accountBId = await makePropAccount(userB.id, "Prop B");
  const ruleSetB = await createPropFirmRuleSet(userB.id, {
    name: "TestFirm 10k",
    firm: "TestFirm",
    phases: [phaseRule()],
    resetTimeLocal: "22:00",
    timezone: "Europe/Paris",
    notes: null,
  });
  const challengeB = await createPropChallenge(userB.id, {
    accountId: accountBId,
    ruleSetId: ruleSetB.id,
    name: "Challenge B",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "500",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeBId = challengeB!.id;
  await seedClosedTrade(userB.id, accountBId, daysAgo(2), "-6000");

  // ── Users C/D: same equity dip, trailing vs static basis ──
  const c = await createUserWithDefaults({
    email: "prop-c@test.local",
    password: "test-password-123",
    displayName: "Prop C",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userC = c.user;
  accountCId = await makePropAccount(userC.id, "Prop C");
  const ruleSetC = await createPropFirmRuleSet(userC.id, {
    name: "Trailing",
    firm: "TestFirm",
    phases: [
      phaseRule({
        drawdownType: "TRAILING",
        minTradingDays: 0,
        maxTradingDays: null,
      }),
    ],
    resetTimeLocal: "00:00",
    timezone: "UTC",
    notes: null,
  });
  const challengeC = await createPropChallenge(userC.id, {
    accountId: accountCId,
    ruleSetId: ruleSetC.id,
    name: "Challenge C",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "0",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeCId = challengeC!.id;
  await db.accountEquitySnapshot.create({
    data: {
      userId: userC.id,
      accountId: accountCId,
      time: daysAgo(2),
      balance: "90000",
      equity: "90000",
    },
  });

  const d = await createUserWithDefaults({
    email: "prop-d@test.local",
    password: "test-password-123",
    displayName: "Prop D",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userD = d.user;
  accountDId = await makePropAccount(userD.id, "Prop D");
  const ruleSetD = await createPropFirmRuleSet(userD.id, {
    name: "Static",
    firm: "TestFirm",
    phases: [
      phaseRule({ minTradingDays: 0, maxTradingDays: null }),
    ],
    resetTimeLocal: "00:00",
    timezone: "UTC",
    notes: null,
  });
  const challengeD = await createPropChallenge(userD.id, {
    accountId: accountDId,
    ruleSetId: ruleSetD.id,
    name: "Challenge D",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "0",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeDId = challengeD!.id;
  await db.accountEquitySnapshot.create({
    data: {
      userId: userD.id,
      accountId: accountDId,
      time: daysAgo(2),
      balance: "90000",
      equity: "90000",
    },
  });

  // ── User E: phase 1 passed, phase 2 starts from its ending balance ──
  const e = await createUserWithDefaults({
    email: "prop-e@test.local",
    password: "test-password-123",
    displayName: "Prop E",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userE = e.user;
  accountEId = await makePropAccount(userE.id, "Prop E");
  const ruleSetE = await createPropFirmRuleSet(userE.id, {
    name: "Two phases",
    firm: "TestFirm",
    phases: [
      phaseRule(),
      phaseRule({
        phase: "PHASE_2",
        profitTargetPercent: "5",
        minTradingDays: 2,
      }),
    ],
    resetTimeLocal: "00:00",
    timezone: "UTC",
    notes: null,
  });
  const challengeE = await createPropChallenge(userE.id, {
    accountId: accountEId,
    ruleSetId: ruleSetE.id,
    name: "Challenge E",
    firm: "TestFirm",
    accountSize: "100000",
    challengeFee: "0",
    feeCurrency: "USD",
    startDate: startDay,
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeEId = challengeE!.id;
  await createPropPhaseResult(userE.id, challengeEId, {
    phase: "PHASE_1",
    startDate: startDay,
    endDate: isoDayOf(daysAgo(10)),
    startingBalance: "100000",
    endingBalance: "110000",
    result: "PASSED",
    tradingDaysCount: 8,
  });
  await updatePropChallenge(userE.id, challengeEId, {
    currentPhase: "PHASE_2",
  });
  await seedClosedTrade(userE.id, accountEId, daysAgo(3), "3000");
  await seedClosedTrade(userE.id, accountEId, daysAgo(2), "3000");
});

afterAll(async () => {
  await db.user.deleteMany({
    where: {
      id: { in: [userA.id, userB.id, userC.id, userD.id, userE.id] },
    },
  });
  await db.$disconnect();
});

describe("prop challenge evaluation", () => {
  it("evaluates only this challenge's trades, with the deposit excluded from P&L", async () => {
    const evaluation = await getPropChallengeEvaluation(userA.id, challengeAId);
    expect(evaluation).not.toBeNull();
    expect(evaluation!.phase).toBe("PHASE_1");
    expect(evaluation!.tradingDays).toBe(5);
    expect(evaluation!.currentEquity).toBe("112500");
    expect(evaluation!.currentBalance).toBe("132500");
    expect(evaluation!.equityData).toBe("CLOSED_ONLY");
    expect(evaluation!.phaseOutcome.outcome).toBe("PASSED");
    expect(evaluation!.phaseOutcome.recommendedAction).toBe("MARK_PHASE_PASSED");
    const target = evaluation!.rules.find((r) => r.rule === "PROFIT_TARGET");
    expect(target?.status).toBe("PASS");
    expect(target?.used).toBe("12500");
    const daily = evaluation!.rules.find((r) => r.rule === "DAILY_LOSS");
    expect(daily?.status).toBe("PASS");
    expect(evaluation!.fees.challengeFee).toBe("500");
  });

  it("a second challenge on another account does not leak into the first", async () => {
    const first = await getPropChallengeEvaluation(userA.id, challengeAId);
    expect(first!.phaseOutcome.outcome).toBe("PASSED");
    const second = await getPropChallengeEvaluation(userA.id, challengeA2Id);
    expect(second!.phaseOutcome.outcome).toBe("FAILED");
    expect(second!.phaseOutcome.failReason).toBe("MAX_DAILY_LOSS");
    const daily = second!.rules.find((r) => r.rule === "DAILY_LOSS");
    expect(daily?.status).toBe("BREACH");
    expect(daily?.used).toBe("6000");
  });

  it("frozen timezone and reset survive a rule set edit", async () => {
    const challenge = await db.propChallenge.findUnique({
      where: { id: challengeAId },
      select: { ruleTimezone: true, ruleResetTimeLocal: true },
    });
    expect(challenge?.ruleTimezone).toBe("Europe/Paris");
    expect(challenge?.ruleResetTimeLocal).toBe("22:00");
    await updatePropFirmRuleSet(userA.id, ruleSetAId, {
      timezone: "UTC",
      resetTimeLocal: "00:00",
    });
    const evaluation = await getPropChallengeEvaluation(userA.id, challengeAId);
    expect(evaluation!.timezone).toBe("Europe/Paris");
    expect(evaluation!.resetTimeLocal).toBe("22:00");
  });

  it("user B cannot evaluate user A's challenge (server + api)", async () => {
    expect(await getPropChallengeEvaluation(userB.id, challengeAId)).toBeNull();
    await loginAs(userB.id);
    const denied = await getEvaluation(
      new Request("http://localhost/api/prop-firms/challenges/x/evaluation"),
      { params: Promise.resolve({ id: challengeAId }) },
    );
    expect(denied.status).toBe(404);
  });

  it("api: the owner gets the evaluation", async () => {
    await loginAs(userA.id);
    const res = await getEvaluation(
      new Request("http://localhost/api/prop-firms/challenges/x/evaluation"),
      { params: Promise.resolve({ id: challengeAId }) },
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    const evaluation = body.evaluation as {
      challengeId: string;
      phaseOutcome: { outcome: string };
    };
    expect(evaluation.challengeId).toBe(challengeAId);
    expect(evaluation.phaseOutcome.outcome).toBe("PASSED");
  });

  it("dashboard prop-status uses the engine when a challenge exists", async () => {
    const payload = await getPropStatus(userA.id, accountA1Id);
    expect(payload).not.toBeNull();
    // Challenge rule (5% daily, 10% target), not the legacy account fields (2%, 5000).
    expect(payload!.status!.dailyLoss.limitAmount).toBe("5000");
    expect(payload!.status!.profitTarget.targetAmount).toBe("10000");
    expect(payload!.status!.currentEquity).toBe("112500");
    expect(payload!.status!.todayPnl).toBe("0");
    expect(payload!.status!.drawdownType).toBe("STATIC");
  });

  it("dashboard prop-status keeps the legacy fields without a challenge", async () => {
    const payload = await getPropStatus(userA.id, accountA3Id);
    expect(payload).not.toBeNull();
    expect(payload!.status!.dailyLoss.limitAmount).toBe("2000");
    expect(payload!.status!.profitTarget.targetAmount).toBe("5000");
    expect(payload!.status!.currentEquity).toBe("99000");
  });

  it("an equity dip breaches a trailing rule but not a static one", async () => {
    const trailing = await getPropChallengeEvaluation(userC.id, challengeCId);
    const ddTrailing = trailing!.rules.find((r) => r.rule === "TOTAL_DRAWDOWN");
    expect(ddTrailing?.status).toBe("BREACH");
    expect(ddTrailing?.used).toBe("10000");
    expect(trailing!.equityData).toBe("SNAPSHOTS");
    expect(trailing!.phaseOutcome.outcome).toBe("FAILED");

    const staticEval = await getPropChallengeEvaluation(userD.id, challengeDId);
    const ddStatic = staticEval!.rules.find((r) => r.rule === "TOTAL_DRAWDOWN");
    expect(ddStatic?.status).toBe("PASS");
    expect(ddStatic?.used).toBe("0");
    expect(staticEval!.equityData).toBe("SNAPSHOTS");
    expect(staticEval!.equityDataNote).toMatch("balance");
  });

  it("phase 2 starts from phase 1 ending balance and its own rule", async () => {
    const evaluation = await getPropChallengeEvaluation(userE.id, challengeEId);
    expect(evaluation!.phase).toBe("PHASE_2");
    expect(evaluation!.phaseStartingBalance).toBe("110000");
    const target = evaluation!.rules.find((r) => r.rule === "PROFIT_TARGET");
    expect(target?.limit).toBe("5500");
    expect(target?.used).toBe("6000");
    expect(evaluation!.phaseOutcome.outcome).toBe("PASSED");
  });
});

describe("prop payouts and expenses update/delete", () => {
  it("payout update recomputes net, delete removes it, other user blocked", async () => {
    const payout = await createPropPayout(userA.id, challengeAId, {
      grossAmount: "1000",
      profitSplitPercent: 80,
      currency: "USD",
      status: "REQUESTED",
    });
    expect(payout).not.toBeNull();
    expect(payout!.netAmount).toBe("800");

    const updated = await updatePropPayout(userA.id, challengeAId, payout!.id, {
      grossAmount: "2000",
    });
    expect(updated!.grossAmount).toBe("2000");
    expect(updated!.netAmount).toBe("1600");

    expect(
      await updatePropPayout(userB.id, challengeAId, payout!.id, {
        grossAmount: "9999",
      }),
    ).toBeNull();
    expect(
      await deletePropPayout(userB.id, challengeAId, payout!.id),
    ).toBe(false);

    expect(await deletePropPayout(userA.id, challengeAId, payout!.id)).toBe(true);
    const workspace = await listPropFirmWorkspace(userA.id);
    const challenge = workspace.challenges.find((c) => c.id === challengeAId);
    expect(challenge!.payouts).toEqual([]);
  });

  it("expense update and delete, other user blocked", async () => {
    const expense = await createPropExpense(userA.id, {
      challengeId: challengeAId,
      type: "FEE",
      amount: "500",
      currency: "USD",
      date: isoDayOf(daysAgo(1)),
    });
    expect(expense).not.toBeNull();

    const updated = await updatePropExpense(
      userA.id,
      challengeAId,
      expense!.id,
      { amount: "600" },
    );
    expect(updated!.amount).toBe("600");

    expect(
      await updatePropExpense(userB.id, challengeAId, expense!.id, {
        amount: "1",
      }),
    ).toBeNull();
    expect(
      await deletePropExpense(userB.id, challengeAId, expense!.id),
    ).toBe(false);

    expect(
      await deletePropExpense(userA.id, challengeAId, expense!.id),
    ).toBe(true);
    const workspace = await listPropFirmWorkspace(userA.id);
    const challenge = workspace.challenges.find((c) => c.id === challengeAId);
    expect(challenge!.expenses).toEqual([]);
  });
});
