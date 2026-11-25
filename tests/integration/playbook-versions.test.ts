/**
 * Lot 11 (roadmap §14) - Playbook: frozen-version evaluation, version
 * comparison, per-version performance, checklist status, violation
 * first-seen dates, and pre-trade warnings (PostgreSQL schema
 * promethe_test).
 *
 * The audit found the freeze itself was already stored at entry
 * (strategyVersion on the trade) but never USED: evaluations grouped by
 * strategy only, and the checklist was recorded but never evaluated.
 * These tests pin the fixed behavior end to end through the server
 * functions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createStrategy, updateStrategy } from "@/server/reference";
import {
  compareStrategyVersions,
  getFrozenChecklistItems,
  listVersions,
  strategyVersionPerformance,
} from "@/server/strategy-versions";
import { getTradeDetail } from "@/server/trades";
import { createRule, updateRule } from "@/server/rules";
import { checkPreTradeWarnings } from "@/server/pre-trade-warnings";

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
let userB: { id: string };
let accountAId: string;
let strategyId: string;
let tradeId: string;
let violationTradeId: string;
let checklistItemIds: string[] = [];

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "Test1234!",
    displayName: "Lot 11 Playbook",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  return { user, accountId: accounts[0].id };
}

const daysAgo = (n: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n, 12, 0, 0),
  );
};

beforeAll(async () => {
  const existing = await db.instrument.findFirst({
    where: { symbol: "XAUUSD", userId: null },
  });
  const instrument =
    existing ?? (await db.instrument.create({ data: { userId: null, ...XAUUSD_SPEC } }));
  instrumentId = instrument.id;

  const a = await makeUser("pbv11-a@test.local");
  userA = a.user;
  accountAId = a.accountId;
  const b = await makeUser("pbv11-b@test.local");
  userB = b.user;

  // Strategy v1 with two required checklist items.
  const strategy = await createStrategy(userA.id, {
    name: "London Breakout",
    color: "#10b981",
    status: "ACTIVE",
    timeframes: ["H1"],
    entryRules: "Enter on BOS",
    checklistItems: [
      { label: "HTF trend aligned", category: "ENTRY", order: 0, isRequired: true },
      { label: "Liquidity sweep", category: "ENTRY", order: 1, isRequired: true },
    ],
  });
  strategyId = strategy.id;
  checklistItemIds = strategy.checklistItems.map((c) => c.id);

  // A closed trade entered under v1, with only the first item checked.
  const trade = await db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      strategyId,
      strategyVersion: 1,
      direction: "LONG",
      status: "CLOSED",
      entryTime: daysAgo(3),
      exitTime: daysAgo(2),
      entryPrice: "2000",
      exitPrice: "2015",
      lots: "1",
      netPnl: "150",
      pnlCurrency: "USD",
      rMultiple: "1.5",
      resultType: "WIN",
      riskAmount: "150",
      checklistResults: JSON.stringify({ [checklistItemIds[0]]: true }),
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
  tradeId = trade.id;

  // A second trade (no strategy) carrying the risk amount used by the
  // violation first-seen test.
  const violationTrade = await db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: daysAgo(3),
      exitTime: daysAgo(2),
      entryPrice: "2000",
      exitPrice: "2005",
      lots: "1",
      netPnl: "50",
      pnlCurrency: "USD",
      rMultiple: "0.5",
      resultType: "WIN",
      riskAmount: "150",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
  violationTradeId = violationTrade.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("frozen version at entry", () => {
  it("keeps the trade on v1 after the strategy is edited, with the change reason on the AUTO snapshot", async () => {
    const updated = await updateStrategy(userA.id, strategyId, {
      entryRules: "Enter on BOS + FVG",
      changeNote: "Added FVG after two missed entries",
      checklistItems: [
        { label: "HTF trend aligned", category: "ENTRY", order: 0, isRequired: true },
        { label: "News checked", category: "ENTRY", order: 1, isRequired: true },
      ],
    });
    expect(updated).not.toBeNull();
    expect(updated?.version).toBe(2);

    const trade = await db.trade.findUnique({ where: { id: tradeId } });
    expect(trade?.strategyVersion).toBe(1);

    const versions = await listVersions(userA.id, strategyId);
    expect(versions).not.toBeNull();
    expect(versions).toHaveLength(1);
    expect(versions![0].version).toBe(1);
    expect(versions![0].origin).toBe("AUTO");
    expect(versions![0].note).toBe("Added FVG after two missed entries");
  });

  it("evaluates the trade checklist against the frozen v1 items, not the live list", async () => {
    const frozen = await getFrozenChecklistItems(userA.id, strategyId, 1);
    expect(frozen).not.toBeNull();
    expect(frozen?.map((i) => i.label)).toEqual([
      "HTF trend aligned",
      "Liquidity sweep",
    ]);

    const detail = await getTradeDetail(userA.id, tradeId);
    expect(detail).not.toBeNull();
    expect(detail?.checklistStatus).toEqual({
      requiredTotal: 2,
      requiredChecked: 1,
      missing: ["Liquidity sweep"],
      complete: false,
    });
  });

  it("groups performance by frozen version: v1 earned the trade, v2 earned nothing", async () => {
    const rows = await strategyVersionPerformance(userA.id, strategyId);
    expect(rows).not.toBeNull();
    const v1 = rows?.find((r) => r.version === 1);
    expect(v1?.trades).toBe(1);
    expect(v1?.totalR).toBe(1.5);
    expect(v1?.winRatePct).toBe(100);
    expect(rows?.find((r) => r.version === 2)).toBeUndefined();
  });

  it("compares two snapshots and returns null for same-id and foreign users", async () => {
    // A second definition edit freezes v2, so two snapshots exist.
    await updateStrategy(userA.id, strategyId, {
      entryRules: "Enter on BOS + FVG + sweep",
      changeNote: "Second change",
    });
    const versions = await listVersions(userA.id, strategyId);
    expect(versions).not.toBeNull();
    expect(versions).toHaveLength(2);
    const [older, newer] = [...versions!].sort(
      (a, b) => a.version - b.version,
    );
    const compared = await compareStrategyVersions(
      userA.id,
      strategyId,
      newer.id,
      older.id,
    );
    expect(compared).not.toBeNull();
    // The server orders oldest first regardless of the argument order.
    expect(compared?.a.version).toBe(1);
    expect(compared?.b.version).toBe(2);
    expect(compared?.changes.map((c) => c.field)).toContain("entryRules");

    expect(
      await compareStrategyVersions(userA.id, strategyId, older.id, older.id),
    ).toBeNull();
    expect(
      await compareStrategyVersions(userB.id, strategyId, older.id, newer.id),
    ).toBeNull();
    expect(await strategyVersionPerformance(userB.id, strategyId)).toBeNull();
    expect(await getTradeDetail(userB.id, tradeId)).toBeNull();
  });
});

describe("pre-trade warnings", () => {
  it("warns on unchecked required items and on risk above the limit, never blocking", async () => {
    const rule = await createRule(userA.id, {
      kind: "MAX_RISK_PER_TRADE",
      value: "100",
      isActive: true,
    });
    const warnings = await checkPreTradeWarnings(userA.id, {
      strategyId,
      riskAmount: "150",
      plannedRR: "1.5",
      entryTime: new Date().toISOString(),
      checklistResults: {},
    });
    expect(warnings.map((w) => w.code)).toContain("CHECKLIST_INCOMPLETE");
    expect(warnings.map((w) => w.code)).toContain("MAX_RISK_PER_TRADE");
    // The checklist warning names the missing items.
    const checklist = warnings.find((w) => w.code === "CHECKLIST_INCOMPLETE");
    expect(checklist?.detail).toContain("News checked");
    await db.tradingRule.delete({ where: { id: rule.id } });
  });

  it("warns on nothing when the checklist is complete and the risk is inside the limit", async () => {
    await createRule(userA.id, {
      kind: "MAX_RISK_PER_TRADE",
      value: "100",
      isActive: true,
    });
    const live = await db.strategy.findUnique({
      where: { id: strategyId },
      include: { checklistItems: true },
    });
    const results: Record<string, boolean> = {};
    for (const item of live?.checklistItems ?? []) results[item.id] = true;
    const warnings = await checkPreTradeWarnings(userA.id, {
      strategyId,
      riskAmount: "50",
      plannedRR: "2",
      entryTime: new Date().toISOString(),
      checklistResults: results,
    });
    expect(warnings).toEqual([]);
  });

  it("does not evaluate a foreign strategy", async () => {
    const warnings = await checkPreTradeWarnings(userB.id, {
      strategyId,
      riskAmount: "150",
      plannedRR: "1.5",
      entryTime: new Date().toISOString(),
      checklistResults: {},
    });
    expect(warnings.map((w) => w.code)).not.toContain("CHECKLIST_INCOMPLETE");
  });
});

describe("violation first-seen date", () => {
  it("preserves createdAt when the rule limit changes but the violation survives", async () => {
    const rule = await createRule(userA.id, {
      kind: "MAX_RISK_PER_TRADE",
      value: "100",
      isActive: true,
    });
    const before = await db.tradeRuleViolation.findFirst({
      where: { tradeId: violationTradeId, ruleId: rule.id },
    });
    expect(before).not.toBeNull();
    const firstSeen = before!.createdAt;

    // Tighten the limit but keep the violation: same row, same date.
    await updateRule(userA.id, rule.id, { value: "120" });
    const surviving = await db.tradeRuleViolation.findFirst({
      where: { tradeId: violationTradeId, ruleId: rule.id },
    });
    expect(surviving).not.toBeNull();
    expect(surviving!.createdAt.getTime()).toBe(firstSeen.getTime());

    // Loosen past the trade's risk: the violation disappears.
    await updateRule(userA.id, rule.id, { value: "200" });
    const gone = await db.tradeRuleViolation.findFirst({
      where: { tradeId: violationTradeId, ruleId: rule.id },
    });
    expect(gone).toBeNull();
    await db.tradingRule.delete({ where: { id: rule.id } });
  });
});
