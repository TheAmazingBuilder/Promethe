/**
 * §20 - ChangeLog / undo: transactional coherence when the BEFORE
 * snapshot references rows that were permanently deleted since.
 *
 * Proves against PostgreSQL schema promethe_test:
 *  1. Undo succeeds when the snapshot's strategy was hard-deleted
 *     (Trade.strategy is SetNull): the strategy falls back to null
 *     instead of failing the whole transaction with a foreign-key error.
 *  2. Same for tags (TradeTag is Cascade): dead tag ids are dropped.
 *  3. Control: with everything alive, undo restores the exact strategy,
 *     tags and custom fields.
 *  4. The group is marked undone: a second undo refuses (NOT_UNDOABLE).
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
import { createUserWithDefaults } from "@/server/users";
import {
  loadTradeSnapshots,
  newGroupId,
  undoChangeLogGroup,
  writeTradeChangeLogEntries,
} from "@/server/change-log";

let userA: { id: string; email: string };
let accountAId: string;
let instrumentId: string;

const now = Date.now();

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
      notes: "undo test",
      searchText: "undo test",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const instrument = await db.instrument.create({
    data: {
      userId: null,
      symbol: "XAUUSD-UNDO-TEST",
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
    email: "undo-a@test.local",
    password: "password1",
    displayName: "Undo A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;

  accountAId = (
    await db.account.findFirstOrThrow({ where: { userId: userA.id } })
  ).id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userA.id } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

describe("undo with permanently deleted snapshot references", () => {
  it("restores the trade when the snapshot strategy and tags are gone", async () => {
    const s1 = await db.strategy.create({
      data: { userId: userA.id, name: "Undo Strat 1", searchText: "undo strat 1" },
    });
    const s2 = await db.strategy.create({
      data: { userId: userA.id, name: "Undo Strat 2", searchText: "undo strat 2" },
    });
    const tag = await db.tag.create({
      data: { userId: userA.id, name: "undo-tag" },
    });
    const trade = await makeTrade({
      strategyId: s1.id,
      customFields: JSON.stringify({ note: "before" }),
    });
    await db.tradeTag.create({ data: { tradeId: trade.id, tagId: tag.id } });

    // Simulate a bulk edit: strategy S1 -> S2, tags dropped, custom fields cleared.
    const snapshots = await loadTradeSnapshots(userA.id, [trade.id]);
    const groupId = newGroupId();
    const before = snapshots[0]!.snapshot;
    await db.$transaction(async (tx) => {
      await writeTradeChangeLogEntries(tx, userA.id, groupId, "BULK_UPDATE", [
        {
          tradeId: trade.id,
          before,
          after: { ...before, strategyId: s2.id, tagIds: [], customFields: null },
        },
      ]);
      await tx.trade.update({
        where: { id: trade.id },
        data: { strategyId: s2.id, customFields: null },
      });
      await tx.tradeTag.deleteMany({ where: { tradeId: trade.id } });
    });

    // Permanently delete the strategy and the tag the BEFORE snapshot points to.
    await db.strategy.delete({ where: { id: s1.id } });
    await db.tag.delete({ where: { id: tag.id } });

    // Before the fix this threw a foreign-key error (P2003) and the
    // whole group stayed undoable-but-always-failing.
    const result = await undoChangeLogGroup(userA.id, groupId);
    expect(result.restored).toBe(1);

    const restored = await db.trade.findUnique({ where: { id: trade.id } });
    expect(restored?.strategyId).toBeNull();
    expect(restored?.customFields).toBe(JSON.stringify({ note: "before" }));
    expect(
      await db.tradeTag.findMany({ where: { tradeId: trade.id } })
    ).toHaveLength(0);

    // The group is marked undone: a second undo refuses.
    await expect(undoChangeLogGroup(userA.id, groupId)).rejects.toThrow(
      "NOT_UNDOABLE"
    );

    await db.trade.delete({ where: { id: trade.id } });
    await db.strategy.delete({ where: { id: s2.id } });
  });

  it("restores the exact strategy and tags when everything is alive", async () => {
    const s1 = await db.strategy.create({
      data: { userId: userA.id, name: "Undo Strat 3", searchText: "undo strat 3" },
    });
    const tag = await db.tag.create({
      data: { userId: userA.id, name: "undo-tag-2" },
    });
    const trade = await makeTrade({ strategyId: s1.id });
    await db.tradeTag.create({ data: { tradeId: trade.id, tagId: tag.id } });

    const snapshots = await loadTradeSnapshots(userA.id, [trade.id]);
    const groupId = newGroupId();
    const before = snapshots[0]!.snapshot;
    await db.$transaction(async (tx) => {
      await writeTradeChangeLogEntries(tx, userA.id, groupId, "BULK_UPDATE", [
        {
          tradeId: trade.id,
          before,
          after: { ...before, strategyId: null, tagIds: [], customFields: { x: 1 } },
        },
      ]);
      await tx.trade.update({
        where: { id: trade.id },
        data: { strategyId: null, customFields: JSON.stringify({ x: 1 }) },
      });
      await tx.tradeTag.deleteMany({ where: { tradeId: trade.id } });
    });

    const result = await undoChangeLogGroup(userA.id, groupId);
    expect(result.restored).toBe(1);

    const restored = await db.trade.findUnique({ where: { id: trade.id } });
    expect(restored?.strategyId).toBe(s1.id);
    expect(restored?.customFields).toBeNull();
    expect(
      (await db.tradeTag.findMany({ where: { tradeId: trade.id } })).map(
        (t) => t.tagId
      )
    ).toEqual([tag.id]);

    await db.trade.delete({ where: { id: trade.id } });
    await db.strategy.delete({ where: { id: s1.id } });
    await db.tag.delete({ where: { id: tag.id } });
  });
});
