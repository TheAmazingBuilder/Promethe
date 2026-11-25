/**
 * Prop Firm challenge evaluation (Lot 5) — server side.
 *
 * The engine (src/lib/prop/engine.ts) is pure; this module is the only
 * place that knows the database. It resolves, for one challenge owned by
 * the signed-in user:
 * - the phase rule from the frozen rules snapshot (never the live rule set),
 * - the phase start and starting balance from the recorded phase results,
 * - the timezone and reset time frozen on the challenge (falling back to
 *   the linked rule set, then UTC / "00:00" for legacy rows),
 * - the trades, balance operations and equity snapshots of that ONE
 *   account inside the phase.
 *
 * No trade of another account or another challenge is ever loaded here.
 * Evaluation is computed on demand and deterministic: the history is the
 * day-by-day breakdown plus the recorded phase results, so no extra
 * evaluation table is needed.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import {
  propFirmPhasesSchema,
  PROP_PHASES,
  type PropPhaseRuleInput,
} from "@/lib/validations/prop-firms";
import {
  evaluatePropPhase,
  type PropEngineCashFlow,
  type PropEngineEquityPoint,
  type PropEngineTrade,
} from "@/lib/prop/engine";
import type {
  PropChallengeEvaluationDTO,
  PropPhaseResultDTO,
} from "@/lib/prop-firms/types";

type ChallengeRow = Prisma.PropChallengeGetPayload<{
  include: {
    account: true;
    ruleSet: true;
    phaseResults: true;
    payouts: true;
    expenses: true;
  };
}>;

function parseRulesSnapshot(raw: string): PropPhaseRuleInput[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = propFirmPhasesSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function toPhaseResultDTO(
  row: ChallengeRow["phaseResults"][number],
): PropPhaseResultDTO {
  const day = (date: Date | null) =>
    date == null ? null : date.toISOString().slice(0, 10);
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

const PHASE_ORDER: Record<string, number> = {
  PHASE_1: 0,
  PHASE_2: 1,
  FUNDED: 2,
};

export async function getPropChallengeEvaluation(
  userId: string,
  challengeId: string,
  now = new Date(),
): Promise<PropChallengeEvaluationDTO | null> {
  const challenge = await db.propChallenge.findFirst({
    where: { id: challengeId, userId },
    include: {
      account: true,
      ruleSet: true,
      phaseResults: { orderBy: { startDate: "asc" } },
      // §13: soft-deleted movements never feed the totals.
      payouts: { where: { deletedAt: null } },
      expenses: { where: { deletedAt: null } },
    },
  });
  if (!challenge) return null;

  const phases = parseRulesSnapshot(challenge.rulesSnapshot);
  if (phases.length === 0) return null;

  // The evaluated phase: the current one, or the last recorded phase when
  // the challenge is closed (its currentPhase holds PASSED/FAILED/...).
  const isLivePhase = (PROP_PHASES as readonly string[]).includes(
    challenge.currentPhase,
  );
  const evaluatedPhase = isLivePhase
    ? challenge.currentPhase
    : (challenge.phaseResults
        .filter((r) => (PROP_PHASES as readonly string[]).includes(r.phase))
        .sort(
          (a, b) =>
            (PHASE_ORDER[b.phase] ?? 0) - (PHASE_ORDER[a.phase] ?? 0),
        )[0]?.phase ?? "PHASE_1");
  const rule =
    phases.find((p) => p.phase === evaluatedPhase) ?? phases[0];

  // Phase start and starting balance from the recorded phase results.
  const phaseResults = challenge.phaseResults.filter(
    (r) => r.phase === evaluatedPhase,
  );
  const liveResult =
    phaseResults.find((r) => r.result === "IN_PROGRESS") ??
    phaseResults[phaseResults.length - 1] ??
    null;
  const phaseStart = liveResult?.startDate ?? challenge.startDate;
  let phaseStartingBalance = liveResult?.startingBalance
    ? toD(liveResult.startingBalance)
    : null;
  if (phaseStartingBalance == null) {
    const previous = challenge.phaseResults
      .filter(
        (r) =>
          (PHASE_ORDER[r.phase] ?? 0) < (PHASE_ORDER[evaluatedPhase] ?? 0) &&
          r.endingBalance != null,
      )
      .sort((a, b) => (PHASE_ORDER[b.phase] ?? 0) - (PHASE_ORDER[a.phase] ?? 0))[0];
    phaseStartingBalance = previous?.endingBalance
      ? toD(previous.endingBalance)
      : toD(challenge.accountSize);
  }

  // Frozen timezone / reset time, with the legacy fallback chain.
  const timezone =
    challenge.ruleTimezone ?? challenge.ruleSet?.timezone ?? "UTC";
  const resetTimeLocal =
    challenge.ruleResetTimeLocal ?? challenge.ruleSet?.resetTimeLocal ?? "00:00";

  const [closedTrades, openTrades, cashFlows, equityPoints] =
    await Promise.all([
      db.trade.findMany({
        where: {
          userId,
          accountId: challenge.accountId,
          status: "CLOSED",
          isDraft: false,
          exitTime: { gte: phaseStart },
        },
        select: { entryTime: true, exitTime: true, netPnl: true },
        orderBy: { exitTime: "asc" },
      }),
      db.trade.findMany({
        where: {
          userId,
          accountId: challenge.accountId,
          status: "OPEN",
          entryTime: { gte: phaseStart },
        },
        select: { entryTime: true, exitTime: true, netPnl: true },
      }),
      db.cashTransaction.findMany({
        where: { userId, accountId: challenge.accountId, date: { gte: phaseStart } },
        select: { date: true, amount: true },
        orderBy: { date: "asc" },
      }),
      db.accountEquitySnapshot.findMany({
        where: { userId, accountId: challenge.accountId, time: { gte: phaseStart } },
        select: { time: true, equity: true },
        orderBy: { time: "asc" },
      }),
    ]);

  const trades: PropEngineTrade[] = [
    ...closedTrades.map((t) => ({
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      netPnl: t.netPnl?.toString() ?? null,
    })),
    ...openTrades.map((t) => ({
      entryTime: t.entryTime,
      exitTime: null,
      netPnl: null,
    })),
  ];
  const flows: PropEngineCashFlow[] = cashFlows.map((f) => ({
    date: f.date,
    amount: f.amount.toString(),
  }));
  const points: PropEngineEquityPoint[] = equityPoints.map((p) => ({
    time: p.time,
    equity: p.equity.toString(),
  }));

  const result = evaluatePropPhase({
    phaseStartingBalance: phaseStartingBalance.toString(),
    rule,
    timezone,
    resetTimeLocal,
    trades,
    cashFlows: flows,
    equityPoints: points,
    phaseStart,
    now,
  });

  const feeCurrency = challenge.feeCurrency;
  const mixedCurrencies =
    challenge.payouts.some((p) => p.currency !== feeCurrency) ||
    challenge.expenses.some((e) => e.currency !== feeCurrency);
  const sumInFeeCurrency = (
    rows: { currency: string; amount: { toString(): string } }[],
  ) =>
    rows
      .filter((r) => r.currency === feeCurrency)
      .reduce((sum, r) => sum.plus(toD(r.amount.toString())), toD(0));

  return {
    challengeId: challenge.id,
    phase: evaluatedPhase,
    phaseStart: phaseStart.toISOString().slice(0, 10),
    phaseStartingBalance: phaseStartingBalance.toString(),
    currency: challenge.account.currency,
    timezone,
    resetTimeLocal,
    accountSize: challenge.accountSize.toString(),
    currentBalance: result.currentBalance,
    currentEquity: result.currentEquity,
    peakEquity: result.peakEquity,
    todayPnl: result.todayPnl,
    todayDayKey: result.todayDayKey,
    tradingDays: result.tradingDays,
    equityData: result.equityData,
    equityDataNote: result.equityDataNote,
    timezoneFallback: result.timezoneFallback,
    rule,
    rules: result.rules,
    phaseOutcome: result.phaseOutcome,
    days: result.days,
    phaseHistory: challenge.phaseResults.map(toPhaseResultDTO),
    fees: {
      challengeFee: challenge.challengeFee.toString(),
      feeCurrency,
      totalExpenses: sumInFeeCurrency(
        challenge.expenses.map((e) => ({ currency: e.currency, amount: e.amount })),
      ).toString(),
      // §13: only payouts actually received count as payouts. A REQUESTED
      // payout is money not yet in hand and a REJECTED payout never
      // arrives - counting either inflates the payout totals.
      totalPayoutsGross: sumInFeeCurrency(
        challenge.payouts
          .filter((p) => p.status === "RECEIVED")
          .map((p) => ({ currency: p.currency, amount: p.grossAmount })),
      ).toString(),
      totalPayoutsNet: sumInFeeCurrency(
        challenge.payouts
          .filter((p) => p.status === "RECEIVED")
          .map((p) => ({ currency: p.currency, amount: p.netAmount })),
      ).toString(),
      mixedCurrencies,
    },
    evaluatedAt: now.toISOString(),
  };
}
