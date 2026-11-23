/**
 * v1 Phase 5 — integration tests (PostgreSQL schema promethe_test): journal upsert & isolation,
 * calendar local-day bucketing (Toronto TZ) + summary/streaks, strategy
 * checklist replace-all + immutable versions + per-strategy stats, PROP
 * breach-risk status.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createUserWithDefaults,
} from "@/server/users";
import {
  deleteJournalEntry,
  getJournalEntry,
  journalDays,
  listRecentJournal,
  upsertJournalEntry,
} from "@/server/journal";
import { getCalendar } from "@/server/calendar";
import { getPropStatus } from "@/server/prop-status";
import {
  createStrategy,
  updateStrategy,
} from "@/server/reference";
import {
  createVersion,
  listVersions,
  strategyStats,
  deleteVersion,
} from "@/server/strategies";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Or / Dollar US",
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
let accountBId: string;
let propAccountId: string;

beforeAll(async () => {
  const instrument = await db.instrument.create({
    data: { userId: null, ...XAUUSD_SPEC },
  });
  instrumentId = instrument.id;

  const a = await createUserWithDefaults({
    email: "cal-a@test.local",
    password: "password1",
    displayName: "Cal A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "fr",
  });
  const b = await createUserWithDefaults({
    email: "cal-b@test.local",
    password: "password1",
    displayName: "Cal B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  const accountsA = await db.account.findMany({ where: { userId: userA.id } });
  accountAId = accountsA[0].id;
  const accountsB = await db.account.findMany({ where: { userId: userB.id } });
  accountBId = accountsB[0].id;

  // PROP challenge account for user A: 100k, 5% daily, 10% total, target 10k.
  const prop = await db.account.create({
    data: {
      userId: userA.id,
      name: "Prop FTMO",
      broker: "FTMO",
      type: "PROP",
      currency: "USD",
      initialBalance: "100000",
      maxDailyLossPercent: "5",
      maxTotalDrawdownPercent: "10",
      profitTarget: "10000",
      drawdownType: "STATIC",
    },
  });
  propAccountId = prop.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

/** Minimal CLOSED trade (raw db insert — the API layer is tested elsewhere). */
function makeTrade(overrides: {
  userId: string;
  accountId: string;
  exitTime: Date;
  netPnl: string;
  rMultiple?: string;
  resultType?: string;
  strategyId?: string;
}) {
  return db.trade.create({
    data: {
      userId: overrides.userId,
      accountId: overrides.accountId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime: new Date(overrides.exitTime.getTime() - 3 * 3600_000),
      exitTime: overrides.exitTime,
      entryPrice: "2345.00",
      exitPrice: "2351.80",
      stopLoss: "2340.00",
      lots: "0.5",
      pips: "68",
      netPnl: overrides.netPnl,
      preTradeAnalysis: "",
      postTradeReview: "",
      rMultiple: overrides.rMultiple ?? null,
      resultType:
        overrides.resultType ??
        (Number(overrides.netPnl) > 0
          ? "WIN"
          : Number(overrides.netPnl) < 0
            ? "LOSS"
            : "BREAKEVEN"),
      ...(overrides.strategyId ? { strategyId: overrides.strategyId } : {}),
    },
  });
}

// ── Journal ─────────────────────────────────────────────────────────────────

describe("journal entries", () => {
  it("upserts on (user, date): create then update, never duplicate", async () => {
    const created = await upsertJournalEntry(userA.id, {
      date: "2026-01-06",
      preMarketPlan: "Plan v1",
      keyLevels: "2,350 resistance",
      primaryScenario: "Wait for rejection",
      maxRiskPercent: "1.5",
      stressLevel: 2,
      energyLevel: 4,
      focusLevel: 5,
      nextSessionCommitment: "Wait for confirmation",
      mood: 3,
    });
    expect(created.preMarketPlan).toBe("Plan v1");
    expect(created.keyLevels).toBe("2,350 resistance");
    expect(created.primaryScenario).toBe("Wait for rejection");
    expect(created.maxRiskPercent).toBe("1.5");
    expect(created.stressLevel).toBe(2);
    expect(created.energyLevel).toBe(4);
    expect(created.focusLevel).toBe(5);
    expect(created.nextSessionCommitment).toBe("Wait for confirmation");
    expect(created.mood).toBe(3);

    const updated = await upsertJournalEntry(userA.id, {
      date: "2026-01-06",
      preMarketPlan: "Plan v2",
      keyLevels: "2,360 resistance",
      stressLevel: 1,
      mood: 5,
      keyLesson: "Patience",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.preMarketPlan).toBe("Plan v2");
    expect(updated.keyLevels).toBe("2,360 resistance");
    expect(updated.stressLevel).toBe(1);
    expect(updated.keyLesson).toBe("Patience");

    const rows = await db.journalEntry.findMany({
      where: { userId: userA.id, date: "2026-01-06" },
    });
    expect(rows).toHaveLength(1);
  });

  it("same date, different users → separate entries", async () => {
    await upsertJournalEntry(userA.id, { date: "2026-01-07", keyLesson: "A" });
    await upsertJournalEntry(userB.id, { date: "2026-01-07", keyLesson: "B" });
    const a = await getJournalEntry(userA.id, "2026-01-07");
    const b = await getJournalEntry(userB.id, "2026-01-07");
    expect(a?.keyLesson).toBe("A");
    expect(b?.keyLesson).toBe("B");
  });

  it("getJournalEntry is user-scoped (A cannot read B)", async () => {
    await upsertJournalEntry(userB.id, { date: "2026-01-08", keyLesson: "secret" });
    const asA = await getJournalEntry(userA.id, "2026-01-08");
    expect(asA).toBeNull();
  });

  it("journalDays returns only in-range days of that user", async () => {
    await upsertJournalEntry(userA.id, { date: "2026-01-09" });
    const days = await journalDays(userA.id, "2026-01-01", "2026-01-31");
    expect([...days].sort()).toEqual(["2026-01-06", "2026-01-07", "2026-01-09"]);
    const feb = await journalDays(userA.id, "2026-02-01", "2026-02-28");
    expect(feb.size).toBe(0);
  });

  it("listRecentJournal is user-scoped and newest first", async () => {
    const entries = await listRecentJournal(userA.id);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true);
    }
    expect(entries.every((e) => e.date !== "2026-01-08")).toBe(true);
  });

  it("deletes only the owner's entry", async () => {
    await upsertJournalEntry(userB.id, { date: "2026-01-10" });
    expect(await deleteJournalEntry(userA.id, "2026-01-10")).toBe(false);
    expect(await deleteJournalEntry(userB.id, "2026-01-10")).toBe(true);
    expect(await getJournalEntry(userB.id, "2026-01-10")).toBeNull();
  });
});

// ── Calendar ────────────────────────────────────────────────────────────────

describe("calendar (local-day bucketing, America/Toronto)", () => {
  beforeAll(async () => {
    // January 2026, all on account A.
    // 2026-01-06 15:05 Toronto (20:05 UTC) → +340 (green day, 2 trades)
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-01-06T20:05:00Z"),
      netPnl: "200",
      rMultiple: "1.2",
    });
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-01-06T21:30:00Z"),
      netPnl: "140",
      rMultiple: "0.8",
    });
    // 2026-01-07 21:00 Toronto (2026-01-08 02:00 UTC) → −180 (red day)
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-01-08T02:00:00Z"),
      netPnl: "-180",
      rMultiple: "-1",
    });
    // 2026-01-09 10:00 Toronto → +90 (green)
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-01-09T15:00:00Z"),
      netPnl: "90",
    });
    // 2026-02-01 03:00 UTC → 2026-01-31 22:00 Toronto (margin day, in January!)
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-02-01T03:00:00Z"),
      netPnl: "-50",
    });
    // Noise: user B, same instants — must not leak into A's calendar.
    await makeTrade({
      userId: userB.id,
      accountId: accountBId,
      exitTime: new Date("2026-01-06T20:05:00Z"),
      netPnl: "9999",
    });
  });

  it("buckets exits in the user's local day (UTC+5h shift for Toronto in EST)", async () => {
    const payload = await getCalendar(userA.id, { year: 2026, month: 1 });
    expect(payload.days["2026-01-06"]).toBeDefined();
    expect(payload.days["2026-01-06"].netPnl).toBe("340");
    expect(payload.days["2026-01-06"].tradeCount).toBe(2);
    expect(payload.days["2026-01-06"].wins).toBe(2);
    expect(payload.days["2026-01-06"].totalR).toBe("2");

    // 02:00 UTC on Jan 8 = Jan 7 21:00 Toronto → belongs to the 7th.
    expect(payload.days["2026-01-07"].netPnl).toBe("-180");
    expect(payload.days["2026-01-08"]).toBeUndefined();

    // Margin: Feb 1 03:00 UTC = Jan 31 22:00 Toronto → January.
    expect(payload.days["2026-01-31"].netPnl).toBe("-50");

    // User B's trade never leaks.
    expect(Number(payload.days["2026-01-06"].netPnl)).not.toBe(10239);
  });

  it("marks journal days and folds them into the grid", async () => {
    const payload = await getCalendar(userA.id, { year: 2026, month: 1 });
    expect(payload.days["2026-01-06"].hasJournal).toBe(true); // written above
    expect(payload.days["2026-01-07"]?.hasJournal ?? false).toBe(true);
    // Grid: Monday-first, January 2026 starts a Thursday.
    expect(payload.grid[0].map((c) => c.date)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    const inMonth = payload.grid.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
  });

  it("summary aggregates the month", async () => {
    const payload = await getCalendar(userA.id, { year: 2026, month: 1 });
    const s = payload.summary;
    expect(s.netPnl).toBe("200"); // 340 − 180 + 90 − 50
    expect(s.tradingDays).toBe(4);
    expect(s.greenDays).toBe(2);
    expect(s.redDays).toBe(2);
    expect(s.bestDay).toEqual({ date: "2026-01-06", netPnl: "340" });
    expect(s.worstDay).toEqual({ date: "2026-01-07", netPnl: "-180" });
    expect(Number(s.greenRate)).toBe(50);
  });

  it("streaks: alternating trading days → longest 1, current −1 (Jan 31 red)", async () => {
    const payload = await getCalendar(userA.id, { year: 2026, month: 1 });
    // Trading days: 6 (green) → 7 (red) → 9 (green) → 31 (red).
    expect(payload.streaks.current).toBe(-1);
    expect(payload.streaks.longestWin).toBe(1);
    expect(payload.streaks.longestLoss).toBe(1);
  });

  it("account filter excludes other accounts", async () => {
    const payload = await getCalendar(userA.id, {
      year: 2026,
      month: 1,
      account: propAccountId,
    });
    expect(payload.summary.tradingDays).toBe(0);
    expect(payload.accountId).toBe(propAccountId);
  });
});

// ── Strategies: checklist replace-all, versions, stats ──────────────────────

describe("strategies (checklist, versions, stats)", () => {
  it("creates with a checklist and updates it replace-all", async () => {
    const created = await createStrategy(userA.id, {
      name: "London breakout",
      color: "#f59e0b",
      status: "ACTIVE",
      timeframes: ["M15", "H1"],
      checklistItems: [
        { label: "Biais HT aligné", category: "CONTEXT", order: 0, isRequired: true },
        { label: "Range asiatique identifié", category: "ENTRY", order: 1, isRequired: true },
        { label: "Stop < 0.5 %", category: "RISK", order: 2, isRequired: false },
      ],
    });
    expect(created.checklistItems).toHaveLength(3);
    expect(created.checklistItems[0].label).toBe("Biais HT aligné");
    const firstIds = created.checklistItems.map((c) => c.id);

    const updated = await updateStrategy(userA.id, created.id, {
      name: "London breakout v2",
      checklistItems: [
        { label: "Biais HT aligné", category: "CONTEXT", order: 0, isRequired: true },
        { label: "Cassure validée au volume", category: "ENTRY", order: 1, isRequired: true },
      ],
    });
    expect(updated?.checklistItems).toHaveLength(2);
    expect(updated?.name).toBe("London breakout v2");
    // Replace-all: item ids are REASSIGNED.
    const secondIds = updated!.checklistItems.map((c) => c.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);

    // PATCH without checklistItems → untouched.
    const renamed = await updateStrategy(userA.id, created.id, { name: "LB" });
    expect(renamed?.checklistItems).toHaveLength(2);

    // Old item rows are gone (no orphans).
    const orphans = await db.strategyChecklistItem.count({
      where: { id: { in: firstIds } },
    });
    expect(orphans).toBe(0);
  });

  it("checklist update prunes dead template references", async () => {
    const strategy = await createStrategy(userA.id, {
      name: "PRUNE",
      color: "#10b981",
      status: "ACTIVE",
      timeframes: [],
      checklistItems: [
        { label: "Critère A", category: "ENTRY", order: 0, isRequired: true },
        { label: "Critère B", category: "EXIT", order: 1, isRequired: true },
      ],
    });
    const tpl = await db.tradeTemplate.create({
      data: {
        userId: userA.id,
        name: "Gabarit",
        defaultChecklistItemIds: JSON.stringify([
          strategy.checklistItems[0].id,
          strategy.checklistItems[1].id,
          "fantome",
        ]),
      },
    });
    // Replace with one criterion → its id is NEW: every previously stored
    // reference (old A, old B, ghost) is dead and must be pruned to [].
    // (Matching by id cannot survive a replace-all; the trade form filters
    // ids against the live checklist anyway.)
    await updateStrategy(userA.id, strategy.id, {
      checklistItems: [
        { label: "Critère A", category: "ENTRY", order: 0, isRequired: true },
      ],
    });
    const after = await db.tradeTemplate.findUnique({ where: { id: tpl.id } });
    const ids: string[] = JSON.parse(after!.defaultChecklistItemIds ?? "[]");
    expect(ids).toHaveLength(0);
    expect(ids).not.toContain("fantome");
    await db.tradeTemplate.delete({ where: { id: tpl.id } });
    await db.strategy.delete({ where: { id: strategy.id } });
  });

  it("versions are immutable, monotonic snapshots", async () => {
    const strategy = await createStrategy(userA.id, {
      name: "Versionnée",
      color: "#10b981",
      status: "ACTIVE",
      timeframes: [],
      checklistItems: [
        { label: "Un", category: "ENTRY", order: 0, isRequired: true },
      ],
    });
    const v1 = await createVersion(userA.id, strategy.id, "première");
    expect(v1?.version).toBe(1);
    expect(v1?.snapshot.name).toBe("Versionnée");
    expect(v1?.snapshot.checklistItems).toHaveLength(1);

    // Evolve the definition, snapshot again.
    await updateStrategy(userA.id, strategy.id, {
      name: "Versionnée v2",
      checklistItems: [
        { label: "Un", category: "ENTRY", order: 0, isRequired: true },
        { label: "Deux", category: "RISK", order: 1, isRequired: false },
      ],
    });
    const v2 = await createVersion(userA.id, strategy.id, null);
    expect(v2?.version).toBe(2);
    expect(v2?.snapshot.checklistItems).toHaveLength(2);

    // v1 kept the OLD definition (immutability).
    const maybeVersions = await listVersions(userA.id, strategy.id);
    expect(maybeVersions).not.toBeNull();
    const versions = maybeVersions!;
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2);
    expect(versions[1].version).toBe(1);
    expect(versions[1].snapshot.name).toBe("Versionnée");
    expect(versions[1].snapshot.checklistItems).toHaveLength(1);

    // Another user cannot snapshot or list A's strategy.
    expect(await createVersion(userB.id, strategy.id, "vol")).toBeNull();
    expect(await listVersions(userB.id, strategy.id)).toBeNull();

    // Delete a version.
    const deletion = await deleteVersion(userA.id, strategy.id, versions[0].id);
    expect(deletion).toEqual({ deleted: true, protected: false });
    expect(await listVersions(userA.id, strategy.id)).toHaveLength(1);
    await db.strategy.delete({ where: { id: strategy.id } });
  });

  it("strategyStats groups the user's closed trades per strategy", async () => {
    const s1 = await createStrategy(userA.id, {
      name: "Stats A",
      color: "#10b981",
      status: "ACTIVE",
      timeframes: [],
    });
    const s2 = await createStrategy(userB.id, {
      name: "Stats B",
      color: "#10b981",
      status: "ACTIVE",
      timeframes: [],
    });
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-03-02T15:00:00Z"),
      netPnl: "100",
      rMultiple: "1",
      strategyId: s1.id,
    });
    await makeTrade({
      userId: userA.id,
      accountId: accountAId,
      exitTime: new Date("2026-03-03T15:00:00Z"),
      netPnl: "-40",
      rMultiple: "-0.4",
      strategyId: s1.id,
    });
    await makeTrade({
      userId: userB.id,
      accountId: accountBId,
      exitTime: new Date("2026-03-02T15:00:00Z"),
      netPnl: "777",
      strategyId: s2.id,
    });

    const stats = await strategyStats(userA.id);
    const mine = stats.find((s) => s.key === s1.id);
    expect(mine?.stats.tradeCount).toBe(2);
    expect(mine?.stats.netPnl).toBe("60");
    expect(mine?.stats.wins).toBe(1);
    // B's strategy is not in A's stats.
    expect(stats.find((s) => s.key === s2.id)).toBeUndefined();
    await db.strategy.delete({ where: { id: s1.id } });
    await db.strategy.delete({ where: { id: s2.id } });
  });
});

// ── PROP status ─────────────────────────────────────────────────────────────

describe("prop status", () => {
  beforeAll(async () => {
    // Closed trades on the PROP account: 3 losing days (-3000 each) → −9000
    // total drawdown (9% of 100k, limit 10k → 90% = WARNING), plus one trade
    // closed "now" for the daily loss dimension.
    await makeTrade({
      userId: userA.id,
      accountId: propAccountId,
      exitTime: new Date(Date.now() - 6 * 24 * 3600_000),
      netPnl: "-3000",
    });
    await makeTrade({
      userId: userA.id,
      accountId: propAccountId,
      exitTime: new Date(Date.now() - 5 * 24 * 3600_000),
      netPnl: "-3000",
    });
    await makeTrade({
      userId: userA.id,
      accountId: propAccountId,
      exitTime: new Date(),
      netPnl: "-3000",
    });
  });

  it("computes equity, drawdown and daily loss for the PROP account", async () => {
    const payload = await getPropStatus(userA.id);
    expect(payload).not.toBeNull();
    expect(payload?.account.id).toBe(propAccountId);

    const status = payload!.status!;
    expect(status.initialBalance).toBe("100000");
    expect(status.currentEquity).toBe("91000");
    expect(status.drawdownType).toBe("STATIC");

    // Daily loss: 3000 / 5000 = 60% → OK.
    expect(status.dailyLoss.limitAmount).toBe("5000");
    expect(status.dailyLoss.used).toBe("3000");
    expect(status.dailyLoss.status).toBe("OK");

    // Total drawdown: 9000 / 10000 = 90% → WARNING.
    expect(status.totalDrawdown.limitAmount).toBe("10000");
    expect(status.totalDrawdown.used).toBe("9000");
    expect(status.totalDrawdown.status).toBe("WARNING");
    expect(status.overall).toBe("WARNING");
    expect(status.breached).toBe(false);

    // Profit target: gained 0 (equity < initial).
    expect(status.profitTarget.gained).toBe("0");
    expect(status.profitTarget.reached).toBe(false);
  });

  it("falls back to the explicit account and respects ownership", async () => {
    const explicit = await getPropStatus(userA.id, propAccountId);
    expect(explicit?.account.id).toBe(propAccountId);

    // User B has no PROP account.
    const b = await getPropStatus(userB.id);
    expect(b).toBeNull();
  });
});
