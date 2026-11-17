/**
 * Bulk trade edits (v2.5 Module 4 §4.4) - one transaction for the whole
 * selection, one ChangeLog group for undo.
 *
 * Supported ops (delete is exclusive): change strategy, change account,
 * add tags, remove tags, or soft-delete to the trash. Ownership of every
 * relation is checked before the transaction; the trade list query is
 * re-used for nothing here - the selection is explicit ids.
 */
import { db } from "@/lib/db";
import {
  loadTradeSnapshots,
  newGroupId,
  writeTradeChangeLogEntries,
  type TradeUndoSnapshot,
} from "@/server/change-log";
import { refreshTradeSearchText } from "@/server/search-index";
import type { BulkTradesInput } from "@/lib/validations/productivity";

export class BulkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkValidationError";
  }
}

export interface BulkResult {
  groupId: string;
  count: number;
  action: "BULK_UPDATE" | "DELETE";
}

export async function bulkUpdateTrades(
  userId: string,
  input: BulkTradesInput
): Promise<BulkResult> {
  // ── Ownership checks (before touching anything) ──
  if (input.strategyId !== undefined && input.strategyId !== null) {
    const strategy = await db.strategy.findFirst({
      where: { id: input.strategyId, userId },
      select: { id: true },
    });
    if (!strategy) throw new BulkValidationError("STRATEGY_NOT_FOUND");
  }
  if (input.accountId !== undefined && input.accountId !== null) {
    const account = await db.account.findFirst({
      where: { id: input.accountId, userId },
      select: { id: true },
    });
    if (!account) throw new BulkValidationError("ACCOUNT_NOT_FOUND");
  }
  const tagIds = [...new Set([...input.addTagIds, ...input.removeTagIds])];
  if (tagIds.length > 0) {
    const found = await db.tag.findMany({
      where: { userId, id: { in: tagIds } },
      select: { id: true },
    });
    if (found.length !== tagIds.length) {
      throw new BulkValidationError("TAG_NOT_FOUND");
    }
  }

  const snapshots = await loadTradeSnapshots(userId, input.tradeIds);
  if (snapshots.length === 0) throw new BulkValidationError("TRADE_NOT_FOUND");
  const groupId = newGroupId();
  const nowIso = new Date().toISOString();

  if (input.deleteToTrash) {
    const entries = snapshots.map((s) => ({
      tradeId: s.id,
      before: s.snapshot,
      after: { ...s.snapshot, deletedAt: nowIso } as TradeUndoSnapshot,
    }));
    await db.$transaction(async (tx) => {
      await tx.trade.updateMany({
        where: { userId, id: { in: snapshots.map((s) => s.id) } },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
      await writeTradeChangeLogEntries(tx, userId, groupId, "DELETE", entries);
    });
    return { groupId, count: snapshots.length, action: "DELETE" };
  }

  const entries = snapshots.map((s) => {
    const after: TradeUndoSnapshot = {
      strategyId:
        input.strategyId !== undefined ? input.strategyId : s.snapshot.strategyId,
      accountId:
        input.accountId !== undefined && input.accountId !== null
          ? input.accountId
          : s.snapshot.accountId,
      tagIds: [
        ...s.snapshot.tagIds.filter((id) => !input.removeTagIds.includes(id)),
        ...input.addTagIds.filter((id) => !s.snapshot.tagIds.includes(id)),
      ],
      customFields: s.snapshot.customFields,
      deletedAt: s.snapshot.deletedAt,
    };
    return { tradeId: s.id, before: s.snapshot, after };
  });

  await db.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.trade.update({
        where: { id: e.tradeId },
        data: {
          strategyId: e.after.strategyId,
          accountId: e.after.accountId,
        },
      });
      if (input.removeTagIds.length > 0) {
        await tx.tradeTag.deleteMany({
          where: { tradeId: e.tradeId, tagId: { in: input.removeTagIds } },
        });
      }
      if (input.addTagIds.length > 0) {
        await tx.tradeTag.createMany({
          data: input.addTagIds.map((tagId) => ({ tradeId: e.tradeId, tagId })),
          skipDuplicates: true,
        });
      }
    }
    await writeTradeChangeLogEntries(tx, userId, groupId, "BULK_UPDATE", entries);
  });

  // Tags feed searchText - refresh outside the transaction.
  for (const e of entries) {
    await refreshTradeSearchText(e.tradeId);
  }
  return { groupId, count: entries.length, action: "BULK_UPDATE" };
}
