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
import {
  expenseSnapshot,
  payoutSnapshot,
  validatePayoutDates,
  type PropFinanceAuditAction,
  type PropFinanceAuditKind,
  type PropFinanceMovementSnapshot,
} from "@/lib/prop/finance-audit";
import type {
  PropChallengeDTO,
  PropExpenseDTO,
  PropFinanceAuditDTO,
  PropFirmRuleSetDTO,
  PropFirmWorkspacePayload,
  PropPayoutDTO,
  PropPhaseResultDTO,
} from "@/lib/prop-firms/types";

const CHALLENGE_INCLUDE = {
  account: true,
  phaseResults: { orderBy: { startDate: "asc" as const } },
  // §13: soft-deleted movements never appear in lists or totals. Their
  // data survives only in the finance audit trail.
  payouts: { where: { deletedAt: null }, orderBy: { requestedAt: "desc" as const } },
  expenses: { where: { deletedAt: null }, orderBy: { date: "desc" as const } },
} as const;

/**
 * §13 - a payout date rule was broken (requested before the challenge
 * started, or received before requested). Mapped to a 422 by apiError via
 * CODE_MESSAGES; never a raw stack trace to the client.
 */
export class PropFinanceValidationError extends Error {
  readonly code: "PAYOUT_BEFORE_CHALLENGE_START" | "RECEIVED_BEFORE_REQUESTED";
  readonly status = 422;

  constructor(code: PropFinanceValidationError["code"]) {
    super(code);
    this.name = "PropFinanceValidationError";
    this.code = code;
  }
}

async function writeFinanceAudit(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    challengeId: string | null;
    kind: PropFinanceAuditKind;
    movementId: string;
    action: PropFinanceAuditAction;
    before: PropFinanceMovementSnapshot | null;
    after: PropFinanceMovementSnapshot | null;
  },
): Promise<void> {
  await tx.propFinanceAudit.create({
    data: {
      userId: input.userId,
      challengeId: input.challengeId,
      kind: input.kind,
      movementId: input.movementId,
      action: input.action,
      beforeJson: input.before == null ? null : JSON.stringify(input.before),
      afterJson: input.after == null ? null : JSON.stringify(input.after),
    },
  });
}

function parseAuditSnapshot(raw: string | null): PropFinanceMovementSnapshot | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind !== "PAYOUT" && kind !== "EXPENSE") return null;
    return parsed as PropFinanceMovementSnapshot;
  } catch {
    return null;
  }
}

type ChallengeRow = Prisma.PropChallengeGetPayload<{ include: typeof CHALLENGE_INCLUDE }>;
type RuleSetRow = Prisma.PropFirmRuleSetGetPayload<Record<string, never>>;

function day(date: Date): string;
function day(date: Date | null): string | null;
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
    ruleTimezone: row.ruleTimezone,
    ruleResetTimeLocal: row.ruleResetTimeLocal,
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
      // Lot 5: freeze the day boundary at purchase. The rule set wins when
      // one is chosen; custom challenges use the provided values (UTC /
      // "00:00" when omitted, resolved at evaluation time).
      ruleTimezone: ruleSet?.timezone ?? input.timezone ?? null,
      ruleResetTimeLocal: ruleSet?.resetTimeLocal ?? input.resetTimeLocal ?? null,
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
    select: { id: true, startDate: true },
  });
  if (!challenge) return null;
  // §13 date rules: a payout cannot predate the challenge, and it cannot
  // be received before it was requested. Violations are 422s, not 404s.
  const requestedDay = input.requestedAt ?? day(new Date());
  const dateError = validatePayoutDates({
    startDate: day(challenge.startDate),
    requestedAt: requestedDay,
    receivedAt: input.receivedAt ?? null,
  });
  if (dateError != null) throw new PropFinanceValidationError(dateError);
  const netAmount = toD(input.grossAmount).times(input.profitSplitPercent).div(100).toString();
  const row = await db.$transaction(async (tx) => {
    const created = await tx.propPayout.create({
      data: {
        userId,
        challengeId,
        requestedAt: new Date(`${requestedDay}T00:00:00.000Z`),
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
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "PAYOUT",
      movementId: created.id,
      action: "CREATED",
      before: null,
      after: payoutSnapshot(created),
    });
    return created;
  });
  return toPayoutDTO(row);
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
  const row = await db.$transaction(async (tx) => {
    const created = await tx.propExpense.create({
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
    await writeFinanceAudit(tx, {
      userId,
      challengeId: input.challengeId ?? null,
      kind: "EXPENSE",
      movementId: created.id,
      action: "CREATED",
      before: null,
      after: expenseSnapshot(created),
    });
    return created;
  });
  return toExpenseDTO(row);
}

// ── §13 - payouts and expenses: correct, remove or restore a movement ──
// Every change writes a permanent audit entry (before/after snapshots).
// Deletes are logical: the row stays with deletedAt set, totals and lists
// read live rows only, and the movement can be restored from the history.
// The old hard delete silently changed the evaluation fee totals, which
// are displayed on the challenge - that is the defect this section fixes.
export async function updatePropPayout(
  userId: string,
  challengeId: string,
  payoutId: string,
  patch: PropPayoutPatch,
): Promise<PropPayoutDTO | null> {
  const [challenge, existing] = await Promise.all([
    db.propChallenge.findFirst({
      where: { id: challengeId, userId },
      select: { startDate: true },
    }),
    db.propPayout.findFirst({
      where: { id: payoutId, challengeId, userId, deletedAt: null },
    }),
  ]);
  if (!challenge || !existing) return null;
  // §13 date rules on the merged dates (a patch may move either date).
  const requestedDay =
    patch.requestedAt !== undefined ? patch.requestedAt : day(existing.requestedAt);
  const receivedDay =
    patch.receivedAt !== undefined
      ? patch.receivedAt
      : existing.receivedAt == null
        ? null
        : day(existing.receivedAt);
  const dateError = validatePayoutDates({
    startDate: day(challenge.startDate),
    requestedAt: requestedDay,
    receivedAt: receivedDay,
  });
  if (dateError != null) throw new PropFinanceValidationError(dateError);
  const grossAmount =
    patch.grossAmount !== undefined ? patch.grossAmount : existing.grossAmount.toString();
  const profitSplitPercent =
    patch.profitSplitPercent !== undefined
      ? patch.profitSplitPercent
      : Number(existing.profitSplitPercent);
  const before = payoutSnapshot(existing);
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.propPayout.update({
      where: { id: payoutId },
      data: {
        ...(patch.grossAmount !== undefined ? { grossAmount: patch.grossAmount } : {}),
        ...(patch.profitSplitPercent !== undefined
          ? { profitSplitPercent: String(patch.profitSplitPercent) }
          : {}),
        netAmount: toD(grossAmount).times(profitSplitPercent).div(100).toString(),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.requestedAt !== undefined
          ? { requestedAt: new Date(`${patch.requestedAt}T00:00:00.000Z`) }
          : {}),
        ...(patch.receivedAt !== undefined
          ? {
              receivedAt: patch.receivedAt
                ? new Date(`${patch.receivedAt}T00:00:00.000Z`)
                : null,
            }
          : {}),
        ...(patch.method !== undefined ? { method: patch.method ?? null } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.note !== undefined ? { note: patch.note ?? null } : {}),
      },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "PAYOUT",
      movementId: payoutId,
      action: "UPDATED",
      before,
      after: payoutSnapshot(updated),
    });
    return updated;
  });
  return toPayoutDTO(row);
}

/**
 * §13 - delete is logical: the row keeps its data with deletedAt set, so
 * the audit trail can still show it and the movement can be restored.
 * Totals and lists already exclude deleted rows (see CHALLENGE_INCLUDE and
 * the evaluation), so deleting never rewrites a reported figure silently.
 */
export async function deletePropPayout(
  userId: string,
  challengeId: string,
  payoutId: string,
): Promise<boolean> {
  const existing = await db.propPayout.findFirst({
    where: { id: payoutId, challengeId, userId, deletedAt: null },
  });
  if (!existing) return false;
  await db.$transaction(async (tx) => {
    await tx.propPayout.update({
      where: { id: payoutId },
      data: { deletedAt: new Date() },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "PAYOUT",
      movementId: payoutId,
      action: "DELETED",
      before: payoutSnapshot(existing),
      after: null,
    });
  });
  return true;
}

/** §13 - restore a logically deleted payout back into lists and totals. */
export async function restorePropPayout(
  userId: string,
  challengeId: string,
  payoutId: string,
): Promise<PropPayoutDTO | null> {
  const existing = await db.propPayout.findFirst({
    where: { id: payoutId, challengeId, userId, deletedAt: { not: null } },
  });
  if (!existing) return null;
  const row = await db.$transaction(async (tx) => {
    const restored = await tx.propPayout.update({
      where: { id: payoutId },
      data: { deletedAt: null },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "PAYOUT",
      movementId: payoutId,
      action: "RESTORED",
      before: null,
      after: payoutSnapshot(restored),
    });
    return restored;
  });
  return toPayoutDTO(row);
}

export async function updatePropExpense(
  userId: string,
  challengeId: string,
  expenseId: string,
  patch: PropExpensePatch,
): Promise<PropExpenseDTO | null> {
  const existing = await db.propExpense.findFirst({
    where: { id: expenseId, userId, challengeId, deletedAt: null },
  });
  if (!existing) return null;
  if (patch.challengeId !== undefined && patch.challengeId !== null) {
    const challenge = await db.propChallenge.findFirst({
      where: { id: patch.challengeId, userId },
      select: { id: true },
    });
    if (!challenge) return null;
  }
  const before = expenseSnapshot(existing);
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.propExpense.update({
      where: { id: expenseId },
      data: {
        ...(patch.challengeId !== undefined
          ? { challengeId: patch.challengeId }
          : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.date !== undefined
          ? { date: new Date(`${patch.date}T00:00:00.000Z`) }
          : {}),
        ...(patch.note !== undefined ? { note: patch.note ?? null } : {}),
      },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId: updated.challengeId,
      kind: "EXPENSE",
      movementId: expenseId,
      action: "UPDATED",
      before,
      after: expenseSnapshot(updated),
    });
    return updated;
  });
  return toExpenseDTO(row);
}

export async function deletePropExpense(
  userId: string,
  challengeId: string,
  expenseId: string,
): Promise<boolean> {
  const existing = await db.propExpense.findFirst({
    where: { id: expenseId, userId, challengeId, deletedAt: null },
  });
  if (!existing) return false;
  await db.$transaction(async (tx) => {
    await tx.propExpense.update({
      where: { id: expenseId },
      data: { deletedAt: new Date() },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "EXPENSE",
      movementId: expenseId,
      action: "DELETED",
      before: expenseSnapshot(existing),
      after: null,
    });
  });
  return true;
}

/** §13 - restore a logically deleted expense back into lists and totals. */
export async function restorePropExpense(
  userId: string,
  challengeId: string,
  expenseId: string,
): Promise<PropExpenseDTO | null> {
  const existing = await db.propExpense.findFirst({
    where: { id: expenseId, userId, challengeId, deletedAt: { not: null } },
  });
  if (!existing) return null;
  const row = await db.$transaction(async (tx) => {
    const restored = await tx.propExpense.update({
      where: { id: expenseId },
      data: { deletedAt: null },
    });
    await writeFinanceAudit(tx, {
      userId,
      challengeId,
      kind: "EXPENSE",
      movementId: expenseId,
      action: "RESTORED",
      before: null,
      after: expenseSnapshot(restored),
    });
    return restored;
  });
  return toExpenseDTO(row);
}

/**
 * §13 - the finance audit trail of one challenge, newest first. Only the
 * owner can read it. Each entry carries whether its movement can be
 * restored right now (true only for the latest action being a delete of a
 * row that is still soft-deleted).
 */
export async function listPropFinanceAudit(
  userId: string,
  challengeId: string,
): Promise<PropFinanceAuditDTO[] | null> {
  const challenge = await db.propChallenge.findFirst({
    where: { id: challengeId, userId },
    select: { id: true },
  });
  if (!challenge) return null;
  const [entries, deletedPayouts, deletedExpenses] = await Promise.all([
    db.propFinanceAudit.findMany({
      where: { userId, challengeId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.propPayout.findMany({
      where: { challengeId, deletedAt: { not: null } },
      select: { id: true },
    }),
    db.propExpense.findMany({
      where: { challengeId, deletedAt: { not: null } },
      select: { id: true },
    }),
  ]);
  const deletedIds = new Set([
    ...deletedPayouts.map((p) => p.id),
    ...deletedExpenses.map((e) => e.id),
  ]);
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    movementId: entry.movementId,
    action: entry.action,
    before: parseAuditSnapshot(entry.beforeJson),
    after: parseAuditSnapshot(entry.afterJson),
    restorable: entry.action === "DELETED" && deletedIds.has(entry.movementId),
    createdAt: entry.createdAt.toISOString(),
  }));
}
