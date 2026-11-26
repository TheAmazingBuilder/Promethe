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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Lightweight summary derived from a persisted result, for the history
 * list. The full result (percentiles, buckets, equity bands) is only
 * loaded when a run is opened, so the list stays small.
 */
function summarizeResult(result: unknown) {
  if (!isRecord(result)) return null;
  const ending = isRecord(result.endingBalance) ? result.endingBalance : null;
  const drawdown = isRecord(result.maxDrawdownPercent) ? result.maxDrawdownPercent : null;
  const probabilityOfRuin = numberOrNull(result.probabilityOfRuin);
  const probabilityOfReachingTarget = numberOrNull(result.probabilityOfReachingTarget);
  const medianEndingBalance = ending ? numberOrNull(ending.median) : null;
  const p5EndingBalance = ending ? numberOrNull(ending.p5) : null;
  const p95EndingBalance = ending ? numberOrNull(ending.p95) : null;
  const medianMaxDrawdown = drawdown ? numberOrNull(drawdown.median) : null;
  if (
    probabilityOfRuin == null ||
    probabilityOfReachingTarget == null ||
    medianEndingBalance == null ||
    medianMaxDrawdown == null
  ) {
    return null;
  }
  return {
    probabilityOfRuin,
    probabilityOfReachingTarget,
    medianEndingBalance,
    p5EndingBalance,
    p95EndingBalance,
    medianMaxDrawdown,
    iterations: numberOrNull(result.iterations),
    tradesPerPath: numberOrNull(result.tradesPerPath),
    sampleSize: numberOrNull(result.sampleSize),
    source: typeof result.source === "string" ? result.source : null,
    ruinBehavior: typeof result.ruinBehavior === "string" ? result.ruinBehavior : null,
  };
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
    summary: summarizeResult(parseJson(row.resultJson)),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getMonteCarloRun(userId: string, id: string) {
  const row = await db.monteCarloRun.findFirst({
    where: { id, userId },
    select: { id: true, name: true, paramsJson: true, resultJson: true, createdAt: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    params: parseJson(row.paramsJson),
    result: parseJson(row.resultJson),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createMonteCarloRun(userId: string, input: MonteCarloInputDTO) {
  const account = await db.account.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, name: true, currency: true, initialBalance: true },
  });
  if (!account) throw new MonteCarloDataError("ACCOUNT_NOT_FOUND", 404);

  const isHypothetical = input.source === "HYPOTHETICAL";
  let outcomesR: number[] = [];
  if (!isHypothetical) {
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
    outcomesR = allOutcomes;
    if (outcomesR.length < 5) {
      throw new MonteCarloDataError("MONTE_CARLO_INSUFFICIENT_HISTORY", 422);
    }
  }

  const startingBalance = Number(account.initialBalance.toString());
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    throw new MonteCarloDataError("MONTE_CARLO_BALANCE_INVALID", 422);
  }
  let result: ReturnType<typeof simulateMonteCarlo>;
  try {
    result = simulateMonteCarlo({
      ...(isHypothetical
        ? {}
        : { outcomesR }),
      source: input.source,
      ...(isHypothetical
        ? {
            hypothetical: {
              winRatePercent: input.hypotheticalWinRate as number,
              avgWinR: input.hypotheticalAvgWinR as number,
              avgLossR: input.hypotheticalAvgLossR as number,
            },
          }
        : {}),
      startingBalance,
      riskPercent: input.riskPercent,
      iterations: input.iterations,
      tradesPerPath: input.tradesPerPath,
      targetPercent: input.targetPercent,
      ruinThresholdPercent: input.ruinThresholdPercent,
      ruinBehavior: input.ruinBehavior,
      seed: input.seed,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("MONTE_CARLO_")) {
      throw new MonteCarloDataError(code, 422);
    }
    throw error;
  }
  const params = {
    accountId: account.id,
    accountName: account.name,
    currency: account.currency,
    source: input.source,
    riskPercent: input.riskPercent,
    iterations: input.iterations,
    tradesPerPath: input.tradesPerPath,
    targetPercent: input.targetPercent,
    ruinThresholdPercent: input.ruinThresholdPercent,
    ruinBehavior: input.ruinBehavior,
    ...(isHypothetical
      ? {
          hypotheticalWinRate: input.hypotheticalWinRate,
          hypotheticalAvgWinR: input.hypotheticalAvgWinR,
          hypotheticalAvgLossR: input.hypotheticalAvgLossR,
        }
      : {}),
    seed: input.seed,
    historicalSampleSize: isHypothetical ? 0 : outcomesR.length,
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
