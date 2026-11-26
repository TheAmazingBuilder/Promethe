/**
 * Cross-analysis (§25.7) - integration tests (PostgreSQL schema
 * promethe_test).
 *
 * The server loader must carry the two dimensions the pure engine
 * cannot see: the frozen strategy version and the checklist verdict.
 * The frozen snapshot wins over the live checklist exactly like the
 * trade detail view; a trade with no matching snapshot falls back to
 * the live list; a trade with no strategy (or no required items) has
 * no verdict. Review groups and version buckets come from the same
 * load, and another user's trades never leak in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { getAdvancedAnalytics } from "@/server/advanced-analytics";

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

let instrumentId: string;
let userA: { id: string };
let accountAId: string;

const now = new Date();
const exitAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const entryAt = new Date(exitAt.getTime() - 2 * 60 * 60 * 1000);

async function seedClosedTrade(
  userId: string,
  accountId: string,
  data: {
    strategyId?: string | null;
    strategyVersion?: number | null;
    checklistResults?: Record<string, boolean> | null;
    grade?: string | null;
    resultType: "WIN" | "LOSS";
    rMultiple: string;
    netPnl: string;
  }
) {
  return db.trade.create({
    data: {
      userId,
      accountId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: entryAt,
      exitTime: exitAt,
      entryPrice: "2000",
      exitPrice: "2010",
      lots: "1",
      netPnl: data.netPnl,
      pnlCurrency: "USD",
      rMultiple: data.rMultiple,
      resultType: data.resultType,
      followedPlan: true,
      riskPercent: "1",
      preTradeAnalysis: "",
      postTradeReview: "",
      strategyId: data.strategyId ?? null,
      strategyVersion: data.strategyVersion ?? null,
      checklistResults:
        data.checklistResults == null
          ? null
          : JSON.stringify(data.checklistResults),
      grade: data.grade ?? null,
    },
  });
}

async function seedReview(
  userId: string,
  tradeId: string,
  full: boolean
) {
  return db.tradeReview.create({
    data: {
      userId,
      tradeId,
      playbookMatch: "MATCHED",
      ...(full
        ? {
            followedPlan: true,
            planAdherenceScore: 4,
            executionQuality: 4,
            entryQuality: 4,
            exitQuality: 4,
            riskManagementScore: 4,
            emotionalControlScore: 4,
            wouldTakeAgain: "YES",
            customAnswers: JSON.stringify([
              {
                questionId: "q1",
                question: "Did you wait for confirmation?",
                type: "BOOLEAN",
                answer: true,
              },
            ]),
          }
        : { followedPlan: true }),
    },
  });
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

  const { user } = await createUserWithDefaults({
    email: "cross-analysis-a@test.local",
    password: "Test-Password-123!",
    displayName: "Cross Analysis Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = user;
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  accountAId = accounts[0].id;

  const strategy = await db.strategy.create({
    data: { userId: user.id, name: "Alpha", version: 2 },
  });
  const req1 = await db.strategyChecklistItem.create({
    data: {
      strategyId: strategy.id,
      label: "Req 1",
      category: "ENTRY",
      order: 0,
      isRequired: true,
    },
  });
  await db.strategyChecklistItem.create({
    data: {
      strategyId: strategy.id,
      label: "Opt 1",
      category: "ENTRY",
      order: 1,
      isRequired: false,
    },
  });
  // Frozen snapshot for version 2 adds a second required item the
  // live checklist does not have.
  await db.strategyVersion.create({
    data: {
      strategyId: strategy.id,
      version: 2,
      snapshot: JSON.stringify({
        name: "Alpha",
        description: null,
        color: "#10b981",
        status: "ACTIVE",
        timeframes: [],
        defaultRiskPercent: null,
        targetRR: null,
        entryRules: null,
        exitRules: null,
        riskRules: null,
        strategyVersion: 2,
        detailedDescription: null,
        marketConditions: [],
        entryConditions: [],
        confirmations: [],
        invalidations: [],
        risk: null,
        tradeManagement: [],
        exitPlan: [],
        checklistItems: [
          { id: req1.id, label: "Req 1", category: "ENTRY", order: 0, isRequired: true },
          { id: "req2", label: "Req 2", category: "ENTRY", order: 1, isRequired: true },
        ],
      }),
    },
  });

  // T1: version 1 (no snapshot -> live list), all required checked.
  const t1 = await seedClosedTrade(userA.id, accountAId, {
    strategyId: strategy.id,
    strategyVersion: 1,
    checklistResults: { [req1.id]: true },
    grade: "A",
    resultType: "WIN",
    rMultiple: "2",
    netPnl: "200",
  });
  await seedReview(userA.id, t1.id, true);

  // T2: version 2 (frozen list has Req 2), Req 2 unanswered -> incomplete.
  const t2 = await seedClosedTrade(userA.id, accountAId, {
    strategyId: strategy.id,
    strategyVersion: 2,
    checklistResults: { [req1.id]: true },
    grade: "A",
    resultType: "WIN",
    rMultiple: "1",
    netPnl: "100",
  });
  await seedReview(userA.id, t2.id, false);

  // T3: version 2, both frozen required items checked -> complete.
  await seedClosedTrade(userA.id, accountAId, {
    strategyId: strategy.id,
    strategyVersion: 2,
    checklistResults: { [req1.id]: true, req2: true },
    grade: "B",
    resultType: "LOSS",
    rMultiple: "-1",
    netPnl: "-100",
  });

  // T4: no strategy -> no checklist verdict, not reviewed.
  await seedClosedTrade(userA.id, accountAId, {
    resultType: "WIN",
    rMultiple: "1",
    netPnl: "100",
  });

  // T5: version 1, required item unchecked -> incomplete.
  await seedClosedTrade(userA.id, accountAId, {
    strategyId: strategy.id,
    strategyVersion: 1,
    checklistResults: { [req1.id]: false },
    grade: "C",
    resultType: "LOSS",
    rMultiple: "-1",
    netPnl: "-100",
  });

  // User B: one trade that must never leak into user A's numbers.
  const { user: userB } = await createUserWithDefaults({
    email: "cross-analysis-b@test.local",
    password: "Test-Password-123!",
    displayName: "Cross Analysis Other",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const accountsB = await db.account.findMany({
    where: { userId: userB.id },
  });
  await seedClosedTrade(userB.id, accountsB[0].id, {
    resultType: "WIN",
    rMultiple: "5",
    netPnl: "500",
  });
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { email: { in: ["cross-analysis-a@test.local", "cross-analysis-b@test.local"] } },
  });
});

describe("cross-analysis endpoint - checklist, review and versions from real rows", () => {
  it("loads the module with the frozen checklist verdicts", async () => {
    const payload = await getAdvancedAnalytics(userA.id, {
      period: "all",
      module: "cross-analysis",
    });
    const result = payload.advanced.crossAnalysis;
    expect(result.total).toBe(5);
    // T1 + T3 complete (T2 is incomplete: frozen Req 2 unanswered).
    expect(result.checklist.complete.count).toBe(2);
    expect(result.checklist.complete.winRate).toBe(50);
    expect(result.checklist.complete.avgR).toBe(0.5);
    expect(result.checklist.complete.netPnl).toBe("100");
    // T2 + T5 incomplete.
    expect(result.checklist.incomplete.count).toBe(2);
    expect(result.checklist.incomplete.avgR).toBe(0);
    expect(result.checklist.incomplete.netPnl).toBe("0");
    // T4 has no strategy, so no verdict.
    expect(result.checklist.noChecklist.count).toBe(1);
    expect(result.checklist.comparable).toBe(false);
  });

  it("splits reviewed / not reviewed and full / partial reviews", async () => {
    const payload = await getAdvancedAnalytics(userA.id, {
      period: "all",
      module: "cross-analysis",
    });
    const result = payload.advanced.crossAnalysis;
    expect(result.review.reviewed.count).toBe(2);
    expect(result.review.notReviewed.count).toBe(3);
    expect(result.review.reviewedFull.count).toBe(1);
    expect(result.review.reviewedPartial.count).toBe(1);
    expect(result.review.avgCompleteness).toBe(0.56);
    expect(result.review.reviewed.avgR).toBe(1.5);
    expect(result.review.notReviewed.avgR).toBe(-0.33);
  });

  it("groups by strategy and frozen version, no-strategy kept apart", async () => {
    const payload = await getAdvancedAnalytics(userA.id, {
      period: "all",
      module: "cross-analysis",
    });
    const versions = payload.advanced.crossAnalysis.versions;
    expect(versions).toHaveLength(3);
    const [alpha2, alpha1, none] = versions;
    expect(alpha2.strategyName).toBe("Alpha");
    expect(alpha2.version).toBe(2);
    expect(alpha2.count).toBe(2);
    expect(alpha1.version).toBe(1);
    expect(alpha1.count).toBe(2);
    expect(none.strategyName).toBeNull();
    expect(none.version).toBeNull();
    expect(none.count).toBe(1);
  });
});
