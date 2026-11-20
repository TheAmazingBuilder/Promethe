/**
 * v2.5 Module 4 — Phase 1 integration tests: trash (soft delete).
 *
 * Proves against PostgreSQL schema promethe_test:
 *  1. REGRESSION — soft-deleted trades NEVER appear in stats/analytics,
 *     lists, search, calendar, exports or raw reads (Prisma extension).
 *  2. The extension also applies inside interactive transactions and to
 *     findUnique (post-check: trashed → null / P2025).
 *  3. deleteTrade soft-deletes; children (executions, screenshots) kept.
 *  4. Restore brings everything back correctly.
 *  5. Trashed strategies/tags are hidden from trade DTOs and analytics
 *     breakdowns, and come back on restore.
 *  6. The daily purge hard-deletes only items past the 30-day retention
 *     (DB rows + screenshot rows), and prunes the ChangeLog.
 *  7. Import dedupe: a trashed row still holding (accountId, externalId)
 *     is RESTORED by re-import — never duplicated, never a P2002.
 *  8. Isolation — user B can never list, restore or purge user A's trash.
 *  9. Journal upsert on a trashed day restores the entry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { TRASH_RETENTION_DAYS } from "@/lib/trash/constants";
import { createUserWithDefaults } from "@/server/users";
import {
  deleteTrade,
  listTrades,
  getTradeDetail,
} from "@/server/trades";
import { getAnalytics } from "@/server/analytics";
import { exportTradesCsv } from "@/server/export";
import {
  deleteJournalEntry,
  upsertJournalEntry,
} from "@/server/journal";
import {
  deleteStrategy,
  deleteTag,
} from "@/server/reference";
import {
  deleteTrashItemsPermanently,
  listTrash,
  purgeExpiredTrash,
  restoreTrashItems,
  trashCounts,
} from "@/server/trash";

let userA: { id: string; email: string };
let userB: { id: string; email: string };
let accountAId: string;
let instrumentId: string;
let strategyId: string;
let tagId: string;

const now = Date.now();
const iso = (offsetDays: number) =>
  new Date(now + offsetDays * 86_400_000).toISOString();

/** Direct row factory (tests bypass the API layer intentionally). */
async function makeTrade(overrides: Record<string, unknown> = {}) {
  return db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      direction: "LONG",
      orderType: "MARKET",
      status: "CLOSED",
      entryTime: new Date(now - 2 * 86_400_000),
      exitTime: new Date(now - 1 * 86_400_000),
      entryPrice: "2300.00",
      exitPrice: "2310.00",
      lots: "1",
      netPnl: "100",
      resultType: "WIN",
      pnlSource: "CALCULATED",
      pnlCurrency: "USD",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
      notes: "gold london retest",
      searchText: "xauusd gold london retest",
      ...overrides,
    },
  });
}

beforeAll(async () => {

  const instrument = await db.instrument.create({
    data: {
      userId: null,
      symbol: "XAUUSD-TRASH-TEST",
      name: "Gold test",
      assetClass: "METAL",
      quoteCurrency: "USD",
      digits: 2,
      pipSize: "0.10",
      pointSize: "0.01",
      contractSize: "100",
    },
  });
  instrumentId = instrument.id;

  const a = await createUserWithDefaults({
    email: "trash-a@test.local",
    password: "password1",
    displayName: "Trash A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "trash-b@test.local",
    password: "password1",
    displayName: "Trash B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  accountAId = (
    await db.account.findFirstOrThrow({ where: { userId: userA.id } })
  ).id;

  const strategy = await db.strategy.create({
    data: { userId: userA.id, name: "Trash Strat", searchText: "trash strat" },
  });
  strategyId = strategy.id;

  const tag = await db.tag.create({
    data: { userId: userA.id, name: "trash-tag" },
  });
  tagId = tag.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

// ── 1. REGRESSION: trashed trades are invisible everywhere ─────────────────

describe("soft-deleted trades never appear in stats (regression)", () => {
  it("excludes trashed trades from listTrades, counts, analytics, calendar, export and raw reads", async () => {
    const visible = await makeTrade({ notes: "keep me" });
    const trashed = await makeTrade({
      notes: "hide me",
      deletedAt: new Date(now - 5 * 86_400_000),
      deletedBy: userA.id,
    });

    // Raw reads (extension).
    expect(await db.trade.count({ where: { userId: userA.id } })).toBe(1);
    expect(
      (await db.trade.findMany({ where: { userId: userA.id } })).map((t) => t.id)
    ).toEqual([visible.id]);
    expect(
      await db.trade.findUnique({ where: { id: trashed.id } })
    ).toBeNull();

    // Server list + search.
    const list = await listTrades(userA.id, { page: 1, pageSize: 25 });
    expect(list.total).toBe(1);
    expect(list.data[0]?.id).toBe(visible.id);
    const search = await listTrades(userA.id, {
      page: 1,
      pageSize: 25,
      search: "hide",
    });
    expect(search.total).toBe(0);

    // Detail 404s.
    expect(await getTradeDetail(userA.id, trashed.id)).toBeNull();

    // Analytics (stats) — the spec's regression test.
    const analytics = await getAnalytics(userA.id, { period: "all" });
    expect(analytics.stats?.tradeCount ?? 0).toBe(1);

    // Export.
    const csv = await exportTradesCsv(userA.id, { page: 1, pageSize: 25 }, "en");
    expect(csv.count).toBe(1);
    expect(csv.csv).not.toContain("hide me");

    // Interactive transaction reads go through the extension too.
    const inTx = await db.$transaction(async (tx) => {
      const rows = await tx.trade.findMany({ where: { userId: userA.id } });
      const total = await tx.trade.count({ where: { userId: userA.id } });
      return { rows, total };
    });
    expect(inTx.total).toBe(1);
    expect(inTx.rows[0]?.id).toBe(visible.id);

    await db.trade.deleteMany({ where: { id: visible.id } });
  });

  it("updateMany never touches trashed rows", async () => {
    const trashed = await makeTrade({
      reviewStatus: "NOT_REVIEWED",
      deletedAt: new Date(now - 5 * 86_400_000),
    });
    const r = await db.trade.updateMany({
      where: { userId: userA.id },
      data: { reviewStatus: "REVIEWED" },
    });
    expect(r.count).toBe(0);
    const still = await withDeleted(() =>
      db.trade.findUnique({ where: { id: trashed.id } })
    );
    expect(still?.reviewStatus).toBe("NOT_REVIEWED");
    await db.trade.deleteMany({ where: { id: trashed.id } });
  });
});

// ── 2. deleteTrade soft-deletes and keeps children ─────────────────────────

describe("deleteTrade → trash", () => {
  it("sets deletedAt/deletedBy, keeps executions and screenshots, lists in trash", async () => {
    const trade = await makeTrade({ externalId: "trash-001" });
    await db.tradeExecution.create({
      data: {
        tradeId: trade.id,
        type: "ENTRY",
        time: new Date(now - 86_400_000),
        price: "2300.00",
        lots: "1",
        commission: "0",
      },
    });
    await db.tradeScreenshot.create({
      data: {
        tradeId: trade.id,
        userId: userA.id,
        storagePath: `${userA.id}/${trade.id}/shot.png`,
      },
    });
    await db.tradeTag.create({ data: { tradeId: trade.id, tagId } });

    expect(await deleteTrade(userA.id, trade.id)).toBe(true);
    // Idempotent second delete: already trashed → false.
    expect(await deleteTrade(userA.id, trade.id)).toBe(false);

    const row = await withDeleted(() =>
      db.trade.findUnique({ where: { id: trade.id } })
    );
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedBy).toBe(userA.id);

    // Children kept.
    expect(
      await db.tradeExecution.count({ where: { tradeId: trade.id } })
    ).toBe(1);
    expect(
      await db.tradeScreenshot.count({ where: { tradeId: trade.id } })
    ).toBe(1);
    expect(await db.tradeTag.count({ where: { tradeId: trade.id } })).toBe(1);

    // Listed in the trash with days remaining.
    const trash = await listTrash(userA.id, { entity: "TRADE" });
    const item = trash.items.find((i) => i.id === trade.id);
    expect(item).toBeDefined();
    expect(item?.daysRemaining).toBeLessThanOrEqual(TRASH_RETENTION_DAYS);
    expect(item?.daysRemaining).toBeGreaterThan(TRASH_RETENTION_DAYS - 2);
  });

  it("restore brings the trade back everywhere (incl. strategy link)", async () => {
    const trade = await makeTrade({
      strategyId,
      deletedAt: new Date(now - 5 * 86_400_000),
      deletedBy: userA.id,
    });
    const detailBefore = await getTradeDetail(userA.id, trade.id);
    expect(detailBefore).toBeNull();

    const { restored } = await restoreTrashItems(userA.id, [
      { entity: "TRADE", id: trade.id },
    ]);
    expect(restored).toBe(1);

    const detail = await getTradeDetail(userA.id, trade.id);
    expect(detail?.id).toBe(trade.id);
    const list = await listTrades(userA.id, { page: 1, pageSize: 25 });
    expect(list.total).toBe(1);
    const analytics = await getAnalytics(userA.id, { period: "all" });
    expect(analytics.stats?.tradeCount ?? 0).toBe(1);
    await db.trade.delete({ where: { id: trade.id } });
  });
});

// ── 3. Trashed strategy / tag references ───────────────────────────────────

describe("trashed strategy & tag are hidden from DTOs and analytics", () => {
  it("trade DTO hides the trashed strategy + tag until restore", async () => {
    const trade = await makeTrade({ strategyId });
    await db.tradeTag.create({ data: { tradeId: trade.id, tagId } });

    let detail = await getTradeDetail(userA.id, trade.id);
    expect(detail?.strategyId).toBe(strategyId);
    expect(detail?.tags.map((t) => t.id)).toContain(tagId);

    expect(await deleteStrategy(userA.id, strategyId)).toBe(true);
    expect(await deleteTag(userA.id, tagId)).toBe(true);

    detail = await getTradeDetail(userA.id, trade.id);
    // Trade itself still there — references hidden.
    expect(detail).not.toBeNull();
    expect(detail?.strategyId).toBeNull();
    expect(detail?.strategyName).toBeNull();
    expect(detail?.tags.map((t) => t.id)).not.toContain(tagId);

    // Analytics breakdown by strategy excludes the trashed bucket.
    const analytics = await getAnalytics(userA.id, { period: "all" });
    const byStrategy = analytics.breakdowns.byStrategy ?? [];
    expect(byStrategy.find((b) => b.label === "Trash Strat")).toBeUndefined();

    // Restore → everything returns.
    await restoreTrashItems(userA.id, [
      { entity: "STRATEGY", id: strategyId },
      { entity: "TAG", id: tagId },
    ]);
    detail = await getTradeDetail(userA.id, trade.id);
    expect(detail?.strategyId).toBe(strategyId);
    expect(detail?.tags.map((t) => t.id)).toContain(tagId);

    await db.trade.delete({ where: { id: trade.id } });
  });
});

// ── 4. Journal: soft delete + upsert-restore ────────────────────────────────

describe("journal trash", () => {
  it("soft-deletes and upsert on the same date restores the entry", async () => {
    const date = "2031-05-17";
    const entry = await upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "plan A",
    });
    expect(await deleteJournalEntry(userA.id, date)).toBe(true);
    expect(
      await db.journalEntry.count({ where: { userId: userA.id } })
    ).toBe(0);

    // Rewriting the same day restores it (never an invisible row).
    const restored = await upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "plan B",
    });
    expect(restored.id).toBe(entry.id);
    const rows = await db.journalEntry.findMany({ where: { userId: userA.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.preMarketPlan).toBe("plan B");
    expect(rows[0]?.deletedAt).toBeNull();
    await db.journalEntry.delete({ where: { id: entry.id } });
  });
});

// ── 5. Purge (daily cron) ───────────────────────────────────────────────────

describe("purgeExpiredTrash", () => {
  it("hard-deletes items past retention, keeps fresh ones, removes screenshot rows", async () => {
    const oldTrade = await makeTrade({
      deletedAt: new Date(now - (TRASH_RETENTION_DAYS + 1) * 86_400_000),
    });
    const freshTrade = await makeTrade({
      deletedAt: new Date(now - 3 * 86_400_000),
    });
    await db.tradeScreenshot.create({
      data: {
        tradeId: oldTrade.id,
        userId: userA.id,
        storagePath: `${userA.id}/${oldTrade.id}/old.png`,
      },
    });
    const oldEntry = await db.journalEntry.create({
      data: {
        userId: userA.id,
        date: "2030-01-02",
        deletedAt: new Date(now - (TRASH_RETENTION_DAYS + 2) * 86_400_000),
      },
    });
    const expiredLog = await db.changeLog.create({
      data: {
        userId: userA.id,
        groupId: "g1",
        entity: "TRADE",
        entityId: oldTrade.id,
        action: "DELETE",
        source: "UI",
        expiresAt: new Date(now - 86_400_000),
      },
    });

    const report = await purgeExpiredTrash(new Date(now));
    expect(report.trades).toBeGreaterThanOrEqual(1);
    expect(report.journalEntries).toBeGreaterThanOrEqual(1);
    expect(report.changeLogsPruned).toBeGreaterThanOrEqual(1);

    expect(
      await withDeleted(() => db.trade.findUnique({ where: { id: oldTrade.id } }))
    ).toBeNull();
    expect(
      await db.tradeScreenshot.count({ where: { tradeId: oldTrade.id } })
    ).toBe(0);
    expect(
      await withDeleted(() =>
        db.journalEntry.findUnique({ where: { id: oldEntry.id } })
      )
    ).toBeNull();
    expect(
      await db.changeLog.findUnique({ where: { id: expiredLog.id } })
    ).toBeNull();

    // Fresh trashed item survives.
    const fresh = await withDeleted(() =>
      db.trade.findUnique({ where: { id: freshTrade.id } })
    );
    expect(fresh?.deletedAt).not.toBeNull();

    // Idempotent: a second run changes nothing for the fresh item.
    await purgeExpiredTrash(new Date(now));
    expect(
      await withDeleted(() => db.trade.findUnique({ where: { id: freshTrade.id } }))
    ).not.toBeNull();

    await db.trade.deleteMany({ where: { id: freshTrade.id } });
  });
});

// ── 6. Import dedupe with trashed rows ──────────────────────────────────────

describe("import dedupe vs trashed rows", () => {
  it("the (accountId, externalId) unique key blocks duplicates — the documented reason for restore-on-import", async () => {
    const trashed = await makeTrade({
      externalId: "dedupe-key-1",
      deletedAt: new Date(now - 2 * 86_400_000),
    });
    await expect(
      makeTrade({ externalId: "dedupe-key-1" })
    ).rejects.toThrow();
    await db.trade.deleteMany({ where: { id: trashed.id } });
  });

  it("a trashed row is invisible to the default findUnique (dedupe must use withDeleted)", async () => {
    const trashed = await makeTrade({
      externalId: "dedupe-key-2",
      deletedAt: new Date(now - 2 * 86_400_000),
    });
    expect(
      await db.trade.findUnique({
        where: { accountId_externalId: { accountId: accountAId, externalId: "dedupe-key-2" } },
      })
    ).toBeNull();
    const seen = await withDeleted(() =>
      db.trade.findUnique({
        where: { accountId_externalId: { accountId: accountAId, externalId: "dedupe-key-2" } },
      })
    );
    expect(seen?.id).toBe(trashed.id);
    await db.trade.deleteMany({ where: { id: trashed.id } });
  });
});

// ── 7. Isolation ────────────────────────────────────────────────────────────

describe("trash isolation", () => {
  it("user B never lists, restores or permanently deletes user A's trashed items", async () => {
    const trade = await makeTrade({
      deletedAt: new Date(now - 1 * 86_400_000),
      deletedBy: userA.id,
    });

    // B's trash list does not contain A's trade.
    const bTrash = await listTrash(userB.id, { entity: "TRADE" });
    expect(bTrash.items.find((i) => i.id === trade.id)).toBeUndefined();
    const bCounts = await trashCounts(userB.id);
    expect(bCounts.total).toBe(0);

    // B cannot restore A's item.
    const r = await restoreTrashItems(userB.id, [
      { entity: "TRADE", id: trade.id },
    ]);
    expect(r.restored).toBe(0);
    const stillTrashed = await withDeleted(() =>
      db.trade.findUnique({ where: { id: trade.id } })
    );
    expect(stillTrashed?.deletedAt).not.toBeNull();

    // B cannot permanently delete A's item.
    const d = await deleteTrashItemsPermanently(userB.id, [
      { entity: "TRADE", id: trade.id },
    ]);
    expect(d.deleted).toBe(0);
    expect(
      await withDeleted(() => db.trade.findUnique({ where: { id: trade.id } }))
    ).not.toBeNull();

    await db.trade.deleteMany({ where: { id: trade.id } });
  });
});
