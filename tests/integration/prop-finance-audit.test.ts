/**
 * §13 - Prop Firm finance: payouts and expenses (PostgreSQL schema promethe_test).
 *
 * Proves the §13 rules at server level: soft delete with a permanent audit
 * trail, RECEIVED-only payout totals, date rules, mixed-currency warning,
 * export inclusion and cross-user isolation. The challenge engine itself
 * is covered by tests/integration/prop-evaluation.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { getPropChallengeEvaluation } from "@/server/prop-evaluation";
import { buildUserExport } from "@/server/account-export";
import {
  createPropChallenge,
  createPropExpense,
  createPropFirmRuleSet,
  createPropPayout,
  deletePropExpense,
  deletePropPayout,
  listPropFinanceAudit,
  listPropFirmWorkspace,
  restorePropExpense,
  restorePropPayout,
  updatePropExpense,
  updatePropPayout,
} from "@/server/prop-firms";
import type { PropPhaseRuleInput } from "@/lib/validations/prop-firms";

const now = new Date();
const daysAgo = (n: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n, 12, 0, 0));
const isoDayOf = (d: Date) => d.toISOString().slice(0, 10);

let userA: { id: string };
let userB: { id: string };
let accountAId: string;
let challengeAId: string;
let payoutId: string;
let expenseId: string;

function phaseRule(overrides: Partial<PropPhaseRuleInput> = {}): PropPhaseRuleInput {
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

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "propfin-a@test.local",
    password: "Test1234!",
    displayName: "PropFin A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  const b = await createUserWithDefaults({
    email: "propfin-b@test.local",
    password: "Test1234!",
    displayName: "PropFin B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userB = b.user;

  const account = await db.account.create({
    data: {
      userId: userA.id,
      name: "PropFin A1",
      type: "PROP",
      currency: "USD",
      initialBalance: "100000",
    },
  });
  accountAId = account.id;
  const ruleSet = await createPropFirmRuleSet(userA.id, {
    name: "PropFin Firm",
    firm: "PropFin",
    phases: [phaseRule()],
    resetTimeLocal: "22:00",
    timezone: "Europe/Paris",
    notes: null,
  });
  const challenge = await createPropChallenge(userA.id, {
    accountId: accountAId,
    ruleSetId: ruleSet.id,
    name: "PropFin Challenge",
    firm: "PropFin",
    accountSize: "100000",
    challengeFee: "500",
    feeCurrency: "USD",
    startDate: isoDayOf(daysAgo(30)),
    currentPhase: "PHASE_1",
    status: "IN_PROGRESS",
  });
  challengeAId = challenge!.id;
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { email: { in: ["propfin-a@test.local", "propfin-b@test.local"] } },
  });
  await db.$disconnect();
});

async function totals() {
  const evaluation = await getPropChallengeEvaluation(userA.id, challengeAId);
  expect(evaluation).not.toBeNull();
  return evaluation!.fees;
}

describe("§13 payout lifecycle", () => {
  it("creates a REQUESTED payout: CREATED audit, totals exclude it", async () => {
    const payout = await createPropPayout(userA.id, challengeAId, {
      grossAmount: "1000",
      profitSplitPercent: 80,
      currency: "USD",
      requestedAt: isoDayOf(daysAgo(10)),
      receivedAt: null,
      status: "REQUESTED",
      method: null,
      note: null,
    });
    expect(payout).not.toBeNull();
    payoutId = payout!.id;
    expect(payout!.netAmount).toBe("800");

    const audit = await listPropFinanceAudit(userA.id, challengeAId);
    expect(audit).not.toBeNull();
    const created = audit!.find((e) => e.action === "CREATED" && e.movementId === payoutId);
    expect(created).toBeDefined();
    expect(created!.kind).toBe("PAYOUT");
    expect(created!.before).toBeNull();
    expect(created!.after?.kind).toBe("PAYOUT");
    if (created!.after?.kind === "PAYOUT") {
      expect(created!.after.grossAmount).toBe("1000");
    }

    const fees = await totals();
    expect(fees.totalPayoutsGross).toBe("0");
    expect(fees.totalPayoutsNet).toBe("0");
  });

  it("marks the payout RECEIVED: UPDATED audit, totals include it, net recomputed", async () => {
    const updated = await updatePropPayout(userA.id, challengeAId, payoutId, {
      grossAmount: "2000",
      profitSplitPercent: 80,
      receivedAt: isoDayOf(daysAgo(5)),
      status: "RECEIVED",
    });
    expect(updated).not.toBeNull();
    expect(updated!.netAmount).toBe("1600");

    const audit = await listPropFinanceAudit(userA.id, challengeAId);
    const entry = audit!.find((e) => e.action === "UPDATED" && e.movementId === payoutId);
    expect(entry).toBeDefined();
    expect(entry!.before?.kind).toBe("PAYOUT");
    expect(entry!.after?.kind).toBe("PAYOUT");
    if (entry!.before?.kind === "PAYOUT" && entry!.after?.kind === "PAYOUT") {
      expect(entry!.before.grossAmount).toBe("1000");
      expect(entry!.after.grossAmount).toBe("2000");
      expect(entry!.after.status).toBe("RECEIVED");
    }

    const fees = await totals();
    expect(fees.totalPayoutsGross).toBe("2000");
    expect(fees.totalPayoutsNet).toBe("1600");
  });

  it("deletes the payout: row stays in the DB, lists and totals exclude it, DELETED audit", async () => {
    expect(await deletePropPayout(userA.id, challengeAId, payoutId)).toBe(true);

    const row = await db.propPayout.findUnique({ where: { id: payoutId } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();

    const workspace = await listPropFirmWorkspace(userA.id);
    const challenge = workspace!.challenges.find((c) => c.id === challengeAId);
    expect(challenge!.payouts).toHaveLength(0);

    const fees = await totals();
    expect(fees.totalPayoutsGross).toBe("0");
    expect(fees.totalPayoutsNet).toBe("0");

    const audit = await listPropFinanceAudit(userA.id, challengeAId);
    const entry = audit!.find((e) => e.action === "DELETED" && e.movementId === payoutId);
    expect(entry).toBeDefined();
    expect(entry!.restorable).toBe(true);
    expect(entry!.before?.kind).toBe("PAYOUT");
    if (entry!.before?.kind === "PAYOUT") {
      expect(entry!.before.grossAmount).toBe("2000");
    }
    expect(entry!.after).toBeNull();
  });

  it("restores the payout: back in the lists and totals, RESTORED audit", async () => {
    const restored = await restorePropPayout(userA.id, challengeAId, payoutId);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(payoutId);

    const row = await db.propPayout.findUnique({ where: { id: payoutId } });
    expect(row!.deletedAt).toBeNull();

    const workspace = await listPropFirmWorkspace(userA.id);
    const challenge = workspace!.challenges.find((c) => c.id === challengeAId);
    expect(challenge!.payouts).toHaveLength(1);

    const fees = await totals();
    expect(fees.totalPayoutsGross).toBe("2000");
    expect(fees.totalPayoutsNet).toBe("1600");

    const audit = await listPropFinanceAudit(userA.id, challengeAId);
    const entry = audit!.find((e) => e.action === "RESTORED" && e.movementId === payoutId);
    expect(entry).toBeDefined();
    expect(entry!.restorable).toBe(false);
  });

  it("a second delete of an already deleted payout is a no-op", async () => {
    expect(await deletePropPayout(userA.id, challengeAId, payoutId)).toBe(true);
    expect(await deletePropPayout(userA.id, challengeAId, payoutId)).toBe(false);
    expect(await restorePropPayout(userA.id, challengeAId, payoutId)).not.toBeNull();
  });
});

describe("§13 expense lifecycle", () => {
  it("creates, updates, deletes and restores an expense with an audit trail", async () => {
    const expense = await createPropExpense(userA.id, {
      challengeId: challengeAId,
      type: "RESET",
      amount: "99",
      currency: "USD",
      date: isoDayOf(daysAgo(20)),
      note: null,
    });
    expect(expense).not.toBeNull();
    expenseId = expense!.id;

    let fees = await totals();
    expect(fees.totalExpenses).toBe("99");

    const updated = await updatePropExpense(userA.id, challengeAId, expenseId, {
      amount: "149",
    });
    expect(updated).not.toBeNull();
    fees = await totals();
    expect(fees.totalExpenses).toBe("149");

    expect(await deletePropExpense(userA.id, challengeAId, expenseId)).toBe(true);
    const row = await db.propExpense.findUnique({ where: { id: expenseId } });
    expect(row!.deletedAt).not.toBeNull();
    fees = await totals();
    expect(fees.totalExpenses).toBe("0");

    const restored = await restorePropExpense(userA.id, challengeAId, expenseId);
    expect(restored).not.toBeNull();
    fees = await totals();
    expect(fees.totalExpenses).toBe("149");

    const audit = await listPropFinanceAudit(userA.id, challengeAId);
    const actions = audit!
      .filter((e) => e.movementId === expenseId)
      .map((e) => e.action)
      .reverse();
    expect(actions).toEqual(["CREATED", "UPDATED", "DELETED", "RESTORED"]);
    const updatedEntry = audit!.find(
      (e) => e.action === "UPDATED" && e.movementId === expenseId,
    );
    expect(updatedEntry!.before?.kind).toBe("EXPENSE");
    expect(updatedEntry!.after?.kind).toBe("EXPENSE");
    if (updatedEntry!.before?.kind === "EXPENSE" && updatedEntry!.after?.kind === "EXPENSE") {
      expect(updatedEntry!.before.amount).toBe("99");
      expect(updatedEntry!.after.amount).toBe("149");
    }
  });
});

describe("§13 date and currency rules", () => {
  it("refuses a payout dated before the challenge starts", async () => {
    await expect(
      createPropPayout(userA.id, challengeAId, {
        grossAmount: "100",
        profitSplitPercent: 80,
        currency: "USD",
        requestedAt: isoDayOf(daysAgo(40)),
        receivedAt: null,
        status: "REQUESTED",
        method: null,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "PAYOUT_BEFORE_CHALLENGE_START", status: 422 });
  });

  it("refuses a received date before the requested date", async () => {
    await expect(
      createPropPayout(userA.id, challengeAId, {
        grossAmount: "100",
        profitSplitPercent: 80,
        currency: "USD",
        requestedAt: isoDayOf(daysAgo(10)),
        receivedAt: isoDayOf(daysAgo(11)),
        status: "RECEIVED",
        method: null,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "RECEIVED_BEFORE_REQUESTED", status: 422 });
  });

  it("a foreign-currency payout is recorded but excluded from the totals, with a warning flag", async () => {
    const payout = await createPropPayout(userA.id, challengeAId, {
      grossAmount: "500",
      profitSplitPercent: 80,
      currency: "EUR",
      requestedAt: isoDayOf(daysAgo(3)),
      receivedAt: isoDayOf(daysAgo(2)),
      status: "RECEIVED",
      method: null,
      note: null,
    });
    expect(payout).not.toBeNull();

    const fees = await totals();
    // The USD payout (2000/1600) is counted; the EUR 500 is not.
    expect(fees.totalPayoutsGross).toBe("2000");
    expect(fees.totalPayoutsNet).toBe("1600");
    expect(fees.mixedCurrencies).toBe(true);

    await deletePropPayout(userA.id, challengeAId, payout!.id);
  });
});

describe("§13 isolation and export", () => {
  it("another user cannot touch A's payouts, expenses or audit trail", async () => {
    expect(
      await createPropPayout(userB.id, challengeAId, {
        grossAmount: "1",
        profitSplitPercent: 80,
        currency: "USD",
        requestedAt: isoDayOf(daysAgo(1)),
        receivedAt: null,
        status: "REQUESTED",
        method: null,
        note: null,
      }),
    ).toBeNull();
    expect(
      await updatePropPayout(userB.id, challengeAId, payoutId, { grossAmount: "1" }),
    ).toBeNull();
    expect(await deletePropPayout(userB.id, challengeAId, payoutId)).toBe(false);
    expect(await restorePropPayout(userB.id, challengeAId, payoutId)).toBeNull();
    expect(
      await createPropExpense(userB.id, {
        challengeId: challengeAId,
        type: "FEE",
        amount: "1",
        currency: "USD",
        date: isoDayOf(daysAgo(1)),
        note: null,
      }),
    ).toBeNull();
    expect(
      await updatePropExpense(userB.id, challengeAId, expenseId, { amount: "1" }),
    ).toBeNull();
    expect(await deletePropExpense(userB.id, challengeAId, expenseId)).toBe(false);
    expect(await restorePropExpense(userB.id, challengeAId, expenseId)).toBeNull();
    expect(await listPropFinanceAudit(userB.id, challengeAId)).toBeNull();
  });

  it("the export contains the audit trail and its count, but no soft-deleted movement", async () => {
    // Delete the payout once more so the export sees a soft-deleted row.
    expect(await deletePropPayout(userA.id, challengeAId, payoutId)).toBe(true);

    const built = await buildUserExport(userA.id);
    expect(built).not.toBeNull();
    expect(built!.counts.propFinanceAudits).toBeGreaterThan(0);
    const zip = Object.fromEntries(Object.entries(unzipSync(built!.zip)));
    const propfirms = JSON.parse(strFromU8(zip["propfirms.json"]));
    expect(propfirms.financeAudits.length).toBeGreaterThan(0);
    expect(propfirms.financeAudits[0].action).toBeDefined();
    expect(propfirms.payouts.find((p: { id: string }) => p.id === payoutId)).toBeUndefined();
    expect(propfirms.expenses.find((e: { id: string }) => e.id === expenseId)).toBeDefined();

    expect(await restorePropPayout(userA.id, challengeAId, payoutId)).not.toBeNull();
  });
});
