/**
 * Prop Firm Management — user-scoped CRUD over the existing challenge models.
 * Rule snapshots are immutable per challenge; edits to a reusable rule set
 * never rewrite the terms of a challenge already in progress.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import {
  propFirmPhasesSchema,
  type PropChallengeInput,
  type PropChallengePatch,
  type PropExpenseInput,
  type PropExpensePatch,
  type PropFirmRuleSetInput,
  type PropFirmRuleSetPatch,
  type PropPayoutInput,
  type PropPayoutPatch,
  type PropPhaseResultInput,
} from "@/lib/validations/prop-firms";
import type {
  PropChallengeDTO,
  PropExpenseDTO,
  PropFirmRuleSetDTO,
  PropFirmWorkspacePayload,
  PropPayoutDTO,
  PropPhaseResultDTO,
} from "@/lib/prop-firms/types";

const CHALLENGE_INCLUDE = {
  account: true,
  phaseResults: { orderBy: { startDate: "asc" as const } },
  payouts: { orderBy: { requestedAt: "desc" as const } },
  expenses: { orderBy: { date: "desc" as const } },
} as const;

type ChallengeRow = Prisma.PropChallengeGetPayload<{ include: typeof CHALLENGE_INCLUDE }>;
type RuleSetRow = Prisma.PropFirmRuleSetGetPayload<Record<string, never>>;

function day(date: Date | null): string | null {
  return date == null ? null : date.toISOString().slice(0, 10);
}

function parseRuleSnapshot(raw: string): PropFirmRuleSetInput["phases"] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = propFirmPhasesSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function toRuleSetDTO(row: RuleSetRow): PropFirmRuleSetDTO {
  return {
    id: row.id,
    name: row.name,
    firm: row.firm,
    phases: parseRuleSnapshot(row.phases),
    resetTimeLocal: row.resetTimeLocal,
    timezone: row.timezone,
    notes: row.notes,
    isGlobal: row.userId == null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPhaseResultDTO(row: ChallengeRow["phaseResults"][number]): PropPhaseResultDTO {
  return {
    id: row.id,
    phase: row.phase,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    startingBalance: row.startingBalance?.toString() ?? null,
    endingBalance: row.endingBalance?.toString() ?? null,
    result: row.result,
    failReason: row.failReason,
    tradingDaysCount: row.tradingDaysCount,
  };
}

function toPayoutDTO(row: ChallengeRow["payouts"][number]): PropPayoutDTO {
  return {
    id: row.id,
    requestedAt: row.requestedAt.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
    grossAmount: row.grossAmount.toString(),
    profitSplitPercent: row.profitSplitPercent.toString(),
    netAmount: row.netAmount.toString(),
    currency: row.currency,
    method: row.method,
    status: row.status,
    note: row.note,
  };
}

function toExpenseDTO(row: ChallengeRow["expenses"][number]): PropExpenseDTO {
  return {
    id: row.id,
    challengeId: row.challengeId,
    type: row.type,
    amount: row.amount.toString(),
    currency: row.currency,
    date: row.date.toISOString().slice(0, 10),
    note: row.note,
  };
}

function toChallengeDTO(row: ChallengeRow): PropChallengeDTO {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.account.name,
    accountCurrency: row.account.currency,
    ruleSetId: row.ruleSetId,
    name: row.name,
    firm: row.firm,
    currentPhase: row.currentPhase,
    accountSize: row.accountSize.toString(),
    challengeFee: row.challengeFee.toString(),
    feeCurrency: row.feeCurrency,
    purchaseDate: day(row.purchaseDate),
    startDate: day(row.startDate) ?? row.startDate.toISOString().slice(0, 10),
    endDate: day(row.endDate),
    status: row.status,
    notes: row.notes,
    rulesSnapshot: parseRuleSnapshot(row.rulesSnapshot),
    phaseResults: row.phaseResults.map(toPhaseResultDTO),
    payouts: row.payouts.map(toPayoutDTO),
    expenses: row.expenses.map(toExpenseDTO),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPropFirmWorkspace(userId: string): Promise<PropFirmWorkspacePayload> {
  const [ruleSets, challenges] = await Promise.all([
    db.propFirmRuleSet.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      orderBy: [{ userId: "asc" }, { firm: "asc" }, { name: "asc" }],
    }),
    db.propChallenge.findMany({
      where: { userId },
      include: CHALLENGE_INCLUDE,
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return {
    ruleSets: ruleSets.map(toRuleSetDTO),
    challenges: challenges.map(toChallengeDTO),
  };
}

export async function createPropFirmRuleSet(
  userId: string,
  input: PropFirmRuleSetInput
): Promise<PropFirmRuleSetDTO> {
  const row = await db.propFirmRuleSet.create({
    data: {
      userId,
      name: input.name,
      firm: input.firm,
      phases: JSON.stringify(input.phases),
      resetTimeLocal: input.resetTimeLocal,
      timezone: input.timezone,
      notes: input.notes ?? null,
    },
  });
  return toRuleSetDTO(row);
}

export async function updatePropFirmRuleSet(
  userId: string,
  id: string,
  patch: PropFirmRuleSetPatch
): Promise<PropFirmRuleSetDTO | null> {
  const existing = await db.propFirmRuleSet.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await db.propFirmRuleSet.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.firm !== undefined ? { firm: patch.firm } : {}),
      ...(patch.phases !== undefined ? { phases: JSON.stringify(patch.phases) } : {}),
      ...(patch.resetTimeLocal !== undefined ? { resetTimeLocal: patch.resetTimeLocal } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
    },
    include: { _count: { select: { challenges: true } } },
  });
  return toRuleSetDTO(row);
}

export async function deletePropFirmRuleSet(userId: string, id: string): Promise<boolean> {
  const existing = await db.propFirmRuleSet.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.propFirmRuleSet.delete({ where: { id } });
  return true;
}

export async function createPropChallenge(
  userId: string,
  input: PropChallengeInput
): Promise<PropChallengeDTO | null> {
  const [account, ruleSet] = await Promise.all([
    db.account.findFirst({
      where: { id: input.accountId, userId, type: "PROP" },
      select: { id: true },
    }),
    input.ruleSetId
      ? db.propFirmRuleSet.findFirst({
          where: { id: input.ruleSetId, OR: [{ userId: null }, { userId }] },
        })
      : Promise.resolve(null),
  ]);
  if (!account || (input.ruleSetId != null && !ruleSet)) return null;
  const phases = ruleSet ? parseRuleSnapshot(ruleSet.phases) : (input.phases ?? []);
  if (phases.length === 0) return null;
  const initialPhase = input.currentPhase === "PHASE_2" || input.currentPhase === "FUNDED"
    ? input.currentPhase
    : "PHASE_1";

  const row = await db.propChallenge.create({
    data: {
      userId,
      accountId: input.accountId,
      ruleSetId: ruleSet?.id ?? null,
      name: input.name,
      firm: input.firm,
      currentPhase: input.currentPhase,
      accountSize: input.accountSize,
      challengeFee: input.challengeFee,
      feeCurrency: input.feeCurrency,
      purchaseDate: input.purchaseDate ? new Date(`${input.purchaseDate}T00:00:00.000Z`) : null,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null,
      status: input.status,
      notes: input.notes ?? null,
      rulesSnapshot: JSON.stringify(phases),
      phaseResults: {
        create: {
          phase: initialPhase,
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          startingBalance: input.accountSize,
          result: "IN_PROGRESS",
        },
      },
    },
    include: CHALLENGE_INCLUDE,
  });
  return toChallengeDTO(row);
}

export async function updatePropChallenge(
  userId: string,
  id: string,
  patch: PropChallengePatch
): Promise<PropChallengeDTO | null> {
  const existing = await db.propChallenge.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) return null;
  const row = await db.propChallenge.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.firm !== undefined ? { firm: patch.firm } : {}),
      ...(patch.currentPhase !== undefined ? { currentPhase: patch.currentPhase } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.endDate !== undefined
        ? { endDate: patch.endDate ? new Date(`${patch.endDate}T00:00:00.000Z`) : null }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
    },
    include: CHALLENGE_INCLUDE,
  });
  return toChallengeDTO(row);
}

export async function deletePropChallenge(userId: string, id: string): Promise<boolean> {
  const existing = await db.propChallenge.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.propChallenge.delete({ where: { id } });
  return true;
}

export async function createPropPhaseResult(
  userId: string,
  challengeId: string,
  input: PropPhaseResultInput
): Promise<PropPhaseResultDTO | null> {
  const challenge = await db.propChallenge.findFirst({
    where: { id: challengeId, userId },
    select: { id: true },
  });
  if (!challenge) return null;
  const row = await db.propChallengePhaseResult.create({
    data: {
      challengeId,
      phase: input.phase,
      startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null,
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null,
      startingBalance: input.startingBalance ?? null,
      endingBalance: input.endingBalance ?? null,
      result: input.result,
      failReason: input.failReason ?? null,
      tradingDaysCount: input.tradingDaysCount,
    },
  });
  return {
    id: row.id,
    phase: row.phase,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    startingBalance: row.startingBalance?.toString() ?? null,
    endingBalance: row.endingBalance?.toString() ?? null,
    result: row.result,
    failReason: row.failReason,
    tradingDaysCount: row.tradingDaysCount,
  };
}

export async function createPropPayout(
  userId: string,
  challengeId: string,
  input: PropPayoutInput
): Promise<PropPayoutDTO | null> {
  const challenge = await db.propChallenge.findFirst({
    where: { id: challengeId, userId },
    select: { id: true },
  });
  if (!challenge) return null;
  const netAmount = toD(input.grossAmount).times(input.profitSplitPercent).div(100).toString();
  const row = await db.propPayout.create({
    data: {
      userId,
      challengeId,
      requestedAt: input.requestedAt
        ? new Date(`${input.requestedAt}T00:00:00.000Z`)
        : new Date(),
      receivedAt: input.receivedAt
        ? new Date(`${input.receivedAt}T00:00:00.000Z`)
        : null,
      grossAmount: input.grossAmount,
      profitSplitPercent: String(input.profitSplitPercent),
      netAmount,
      currency: input.currency,
      method: input.method ?? null,
      status: input.status,
      note: input.note ?? null,
    },
  });
  return {
    id: row.id,
    requestedAt: row.requestedAt.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
    grossAmount: row.grossAmount.toString(),
    profitSplitPercent: row.profitSplitPercent.toString(),
    netAmount: row.netAmount.toString(),
    currency: row.currency,
    method: row.method,
    status: row.status,
    note: row.note,
  };
}

export async function createPropExpense(
  userId: string,
  input: PropExpenseInput
): Promise<PropExpenseDTO | null> {
  if (input.challengeId) {
    const challenge = await db.propChallenge.findFirst({
      where: { id: input.challengeId, userId },
      select: { id: true },
    });
    if (!challenge) return null;
  }
  const row = await db.propExpense.create({
    data: {
      userId,
      challengeId: input.challengeId ?? null,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      date: new Date(`${input.date}T00:00:00.000Z`),
      note: input.note ?? null,
    },
  });
  return {
    id: row.id,
    challengeId: row.challengeId,
    type: row.type,
    amount: row.amount.toString(),
    currency: row.currency,
    date: row.date.toISOString().slice(0, 10),
    note: row.note,
  };
}
