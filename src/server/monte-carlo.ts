import { db } from "@/lib/db";
import { simulateMonteCarlo } from "@/lib/analytics/monte-carlo";
import type { MonteCarloInputDTO } from "@/lib/validations/monte-carlo";

export class MonteCarloDataError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "MonteCarloDataError";
    this.code = code;
    this.status = status;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function listMonteCarloRuns(userId: string) {
  const rows = await db.monteCarloRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, paramsJson: true, resultJson: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    params: parseJson(row.paramsJson),
    result: parseJson(row.resultJson),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createMonteCarloRun(userId: string, input: MonteCarloInputDTO) {
  const account = await db.account.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, name: true, currency: true, initialBalance: true },
  });
  if (!account) throw new MonteCarloDataError("ACCOUNT_NOT_FOUND", 404);

  const rows = await db.trade.findMany({
    where: {
      userId,
      accountId: account.id,
      status: "CLOSED",
      isDraft: false,
      rMultiple: { not: null },
    },
    select: { rMultiple: true },
    orderBy: { exitTime: "asc" },
  });
  const allOutcomes = rows.flatMap((row) => {
    if (row.rMultiple == null) return [];
    const value = Number(row.rMultiple.toString());
    return Number.isFinite(value) ? [value] : [];
  });
  if (allOutcomes.some((value) => Math.abs(value) > 20)) {
    throw new MonteCarloDataError("MONTE_CARLO_OUTCOME_OUT_OF_RANGE", 422);
  }
  const outcomesR = allOutcomes;
  if (outcomesR.length < 5) {
    throw new MonteCarloDataError("MONTE_CARLO_INSUFFICIENT_HISTORY", 422);
  }

  const startingBalance = Number(account.initialBalance.toString());
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    throw new MonteCarloDataError("MONTE_CARLO_BALANCE_INVALID", 422);
  }
  const result = simulateMonteCarlo({
    outcomesR,
    startingBalance,
    riskPercent: input.riskPercent,
    iterations: input.iterations,
    tradesPerPath: input.tradesPerPath,
    targetPercent: input.targetPercent,
    ruinThresholdPercent: input.ruinThresholdPercent,
    seed: input.seed,
  });
  const params = {
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    riskPercent: input.riskPercent,
    iterations: input.iterations,
    tradesPerPath: input.tradesPerPath,
    targetPercent: input.targetPercent,
    ruinThresholdPercent: input.ruinThresholdPercent,
    seed: input.seed,
    historicalSampleSize: outcomesR.length,
  };
  const row = await db.monteCarloRun.create({
    data: {
      userId,
      name: input.name,
      paramsJson: JSON.stringify(params),
      resultJson: JSON.stringify(result),
    },
    select: { id: true, name: true, createdAt: true },
  });
  return {
    run: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() },
    account: { id: account.id, name: account.name, currency: account.currency },
    params,
    result,
  };
}

export async function deleteMonteCarloRun(userId: string, id: string): Promise<boolean> {
  const result = await db.monteCarloRun.deleteMany({ where: { id, userId } });
  return result.count > 0;
}
