/**
 * Lot 7 (roadmap section 9) - Monte Carlo history: create, list (light
 * summary), open a saved run, compare data, delete, and the historical /
 * hypothetical split (PostgreSQL schema promethe_test).
 *
 * Stored results are reproducible: re-running the engine from the stored
 * parameters and seed reproduces the stored result exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createMonteCarloRun,
  deleteMonteCarloRun,
  getMonteCarloRun,
  listMonteCarloRuns,
} from "@/server/monte-carlo";
import { simulateMonteCarlo } from "@/lib/analytics/monte-carlo";

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

/** Seeded R-multiples, in ascending exit-time order. */
const SEEDED_R = [1, -0.5, 2, 0.5, -1, 1.5];

let instrumentId: string;
let userA: { id: string };
let userB: { id: string };
let accountAId: string;
let accountBId: string;

const daysAgo = (n: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n, 12, 0, 0));
};

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "Test1234!",
    displayName: "Monte Carlo Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  return { user, accountId: accounts[0].id };
}

beforeAll(async () => {
  const existing = await db.instrument.findFirst({ where: { symbol: "XAUUSD", userId: null } });
  const instrument = existing ?? (await db.instrument.create({ data: { userId: null, ...XAUUSD_SPEC } }));
  instrumentId = instrument.id;

  const a = await makeUser("mc-runs-a@test.local");
  userA = a.user;
  accountAId = a.accountId;
  const b = await makeUser("mc-runs-b@test.local");
  userB = b.user;
  accountBId = b.accountId;

  for (let index = 0; index < SEEDED_R.length; index += 1) {
    const exit = daysAgo(SEEDED_R.length - index);
    await db.trade.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        instrumentId,
        direction: "LONG",
        status: "CLOSED",
        entryTime: new Date(exit.getTime() - 2 * 60 * 60 * 1000),
        exitTime: exit,
        entryPrice: "2000",
        exitPrice: "2010",
        lots: "1",
        netPnl: "100",
        pnlCurrency: "USD",
        rMultiple: String(SEEDED_R[index]),
        preTradeAnalysis: "",
        postTradeReview: "",
      },
    });
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

const historicalInput = (accountId: string, seed: number) => ({
  accountId,
  name: "Historical run",
  source: "HISTORICAL" as const,
  riskPercent: 1,
  iterations: 200,
  tradesPerPath: 20,
  targetPercent: 10,
  ruinThresholdPercent: 30,
  ruinBehavior: "STOP" as const,
  seed,
});

describe("Monte Carlo history", () => {
  it("creates a historical run whose stored result is reproducible from its parameters", async () => {
    const created = await createMonteCarloRun(userA.id, historicalInput(accountAId, 123));
    expect(created.result.source).toBe("HISTORICAL");
    expect(created.result.sampleSize).toBe(SEEDED_R.length);
    expect(created.result.ruinBehavior).toBe("STOP");
    expect(created.params.historicalSampleSize).toBe(SEEDED_R.length);

    const opened = await getMonteCarloRun(userA.id, created.run.id);
    expect(opened).not.toBeNull();
    expect(opened?.params).toEqual(created.params);

    const replayed = simulateMonteCarlo({
      outcomesR: SEEDED_R,
      startingBalance: 10_000,
      riskPercent: 1,
      iterations: 200,
      tradesPerPath: 20,
      targetPercent: 10,
      ruinThresholdPercent: 30,
      ruinBehavior: "STOP",
      seed: 123,
    });
    expect(opened?.result).toEqual(replayed);
  });

  it("lists runs newest first with a light summary and no full result payload", async () => {
    const first = await createMonteCarloRun(userA.id, historicalInput(accountAId, 11));
    const second = await createMonteCarloRun(userA.id, {
      ...historicalInput(accountAId, 22),
      name: "Second run",
      ruinBehavior: "CONTINUE",
    });

    const runs = await listMonteCarloRuns(userA.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0].id).toBe(second.run.id);
    expect(runs[1].id).toBe(first.run.id);
    for (const run of runs) {
      expect(run).not.toHaveProperty("result");
      expect(run.summary).not.toBeNull();
      expect(run.summary?.probabilityOfRuin).toBeGreaterThanOrEqual(0);
      expect(run.summary?.medianEndingBalance).toBeGreaterThan(0);
      expect(run.summary?.source).toBe("HISTORICAL");
    }
    const secondSummary = runs[0].summary;
    expect(secondSummary?.ruinBehavior).toBe("CONTINUE");
    expect(secondSummary?.sampleSize).toBe(SEEDED_R.length);
  });

  it("creates a hypothetical run on an account with no trades, where a historical run is refused", async () => {
    const created = await createMonteCarloRun(userB.id, {
      accountId: accountBId,
      name: "Hypothetical run",
      source: "HYPOTHETICAL",
      riskPercent: 1,
      iterations: 200,
      tradesPerPath: 20,
      targetPercent: 10,
      ruinThresholdPercent: 30,
      ruinBehavior: "STOP",
      hypotheticalWinRate: 55,
      hypotheticalAvgWinR: 1.5,
      hypotheticalAvgLossR: -1,
      seed: 5,
    });
    expect(created.result.source).toBe("HYPOTHETICAL");
    expect(created.result.sampleSize).toBe(0);
    expect(created.params.hypotheticalWinRate).toBe(55);

    await expect(
      createMonteCarloRun(userB.id, historicalInput(accountBId, 5)),
    ).rejects.toMatchObject({ code: "MONTE_CARLO_INSUFFICIENT_HISTORY" });
  });

  it("a run is invisible to another user and cannot be deleted by them", async () => {
    const created = await createMonteCarloRun(userA.id, historicalInput(accountAId, 77));

    expect(await getMonteCarloRun(userB.id, created.run.id)).toBeNull();
    expect(await deleteMonteCarloRun(userB.id, created.run.id)).toBe(false);
    expect(await getMonteCarloRun(userA.id, created.run.id)).not.toBeNull();

    expect(await deleteMonteCarloRun(userA.id, created.run.id)).toBe(true);
    expect(await getMonteCarloRun(userA.id, created.run.id)).toBeNull();
    expect(await listMonteCarloRuns(userA.id)).not.toContainEqual(
      expect.objectContaining({ id: created.run.id }),
    );
    expect(await deleteMonteCarloRun(userA.id, created.run.id)).toBe(false);
  });
});
