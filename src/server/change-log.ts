/**
 * Change history / undo (v2.5 Module 4 §4.5) - ChangeLog groups.
 *
 * One group = one user action (a bulk edit or a bulk/single delete).
 * Each entry stores a compact BEFORE snapshot (strategyId, accountId,
 * tagIds, customFields, deletedAt) so undo restores exactly those fields;
 * derived values (P&L, R) are never snapshotted - they are recomputed by
 * the trade itself and untouched by bulk ops. Entries expire after 30
 * days (the daily trash cron prunes them); undo refuses expired or
 * already-undone groups.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { refreshTradeSearchText } from "@/server/search-index";
import { parseCustomFields } from "@/lib/custom-fields/validate";
import type { ChangeLogGroupDTO } from "@/lib/trading/dto";

export const CHANGE_LOG_TTL_DAYS = 30;

/**
 * Minimal transaction-client shape used by writeTradeChangeLogEntries.
 * (No Prisma type import: the generated client is not present on this VM.)
 */
export interface ChangeLogWriter {
  changeLog: {
    create: (args: {
      data: {
        userId: string;
        groupId: string;
        entity: string;
        entityId: string;
        action: string;
        beforeJson: string | null;
        afterJson: string | null;
        source: string;
        expiresAt: Date;
      };
    }) => Promise<unknown>;
  };
}

export interface TradeUndoSnapshot {
  strategyId: string | null;
  accountId: string;
  tagIds: string[];
  customFields: Record<string, unknown> | null;
  deletedAt: string | null;
}

export function expiryDate(): Date {
  return new Date(Date.now() + CHANGE_LOG_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function snapshotOf(row: {
  strategyId: string | null;
  accountId: string;
  tags: Array<{ tagId: string }>;
  customFields: string | null;
  deletedAt: Date | null;
}): TradeUndoSnapshot {
  return {
    strategyId: row.strategyId,
    accountId: row.accountId,
    tagIds: row.tags.map((t) => t.tagId),
    customFields: parseCustomFields(row.customFields),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function parseSnapshot(raw: string | null): TradeUndoSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TradeUndoSnapshot;
  } catch {
    return null;
  }
}

/** Write one ChangeLog entry per trade inside the caller's transaction. */
export async function writeTradeChangeLogEntries(
  tx: ChangeLogWriter,
  userId: string,
  groupId: string,
  action: "BULK_UPDATE" | "DELETE",
  entries: Array<{ tradeId: string; before: TradeUndoSnapshot; after: TradeUndoSnapshot | null }>
): Promise<void> {
  const expiresAt = expiryDate();
  for (const e of entries) {
    await tx.changeLog.create({
      data: {
        userId,
        groupId,
        entity: "TRADE",
        entityId: e.tradeId,
        action,
        beforeJson: JSON.stringify(e.before),
        afterJson: e.after ? JSON.stringify(e.after) : null,
        source: "BULK",
        expiresAt,
      },
    });
  }
}

/** Load the live rows needed to snapshot a bulk selection. */
export async function loadTradeSnapshots(
  userId: string,
  tradeIds: string[]
): Promise<Array<{ id: string; snapshot: TradeUndoSnapshot }>> {
  const rows = await db.trade.findMany({
    where: { userId, id: { in: tradeIds } },
    select: {
      id: true,
      strategyId: true,
      accountId: true,
      customFields: true,
      deletedAt: true,
      tags: { select: { tagId: true } },
    },
  });
  return rows.map((r) => ({ id: r.id, snapshot: snapshotOf(r) }));
}

/** Grouped history, latest first (one row per groupId). */
export async function listChangeLogGroups(
  userId: string,
  limit = 50
): Promise<ChangeLogGroupDTO[]> {
  const rows = await db.changeLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit * 5,
  });
  const groups = new Map<string, ChangeLogGroupDTO>();
  for (const row of rows) {
    const existing = groups.get(row.groupId);
    if (existing) {
      existing.count += 1;
      if (row.undoneAt && !existing.undoneAt) {
        existing.undoneAt = row.undoneAt.toISOString();
      }
      continue;
    }
    const after = parseSnapshot(row.afterJson);
    groups.set(row.groupId, {
      groupId: row.groupId,
      action: row.action,
      source: row.source,
      entity: row.entity,
      count: 1,
      createdAt: row.createdAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      summary: {
        strategyId: after?.strategyId ?? undefined,
        accountId: after?.accountId ?? undefined,
        tagIds: after?.tagIds,
        deleted: row.action === "DELETE" ? true : after?.deletedAt != null,
      },
    });
    if (groups.size >= limit) break;
  }
  return [...groups.values()];
}

/** Latest still-undoable group (for Cmd+Z). */
export async function latestUndoableGroup(
  userId: string
): Promise<ChangeLogGroupDTO | null> {
  const groups = await listChangeLogGroups(userId, 20);
  const now = new Date();
  return (
    groups.find((g) => !g.undoneAt && new Date(g.expiresAt) > now) ?? null
  );
}

/**
 * Undo a whole group: restore every entry's BEFORE snapshot in one
 * transaction, then mark the group undone. Returns the restored count.
 * Throws Error("NOT_UNDOABLE") when expired, already undone or empty.
 */
export async function undoChangeLogGroup(
  userId: string,
  groupId: string
): Promise<{ restored: number }> {
  const entries = await db.changeLog.findMany({
    where: { userId, groupId },
    orderBy: { createdAt: "asc" },
  });
  if (entries.length === 0) throw new Error("NOT_UNDOABLE");
  const now = new Date();
  if (entries.some((e) => e.undoneAt) || entries[0].expiresAt <= now) {
    throw new Error("NOT_UNDOABLE");
  }
  const restoredIds: string[] = [];
  // Undo must SEE trashed rows (the soft-delete extension hides them from
  // default reads): the whole restore runs inside withDeleted.
  await withDeleted(async () => {
    await db.$transaction(async (tx) => {
      for (const entry of entries) {
        const before = parseSnapshot(entry.beforeJson);
        if (!before) continue;
        // The trade may have been purged since (trash retention) - skip it.
        const exists = await tx.trade.findFirst({
          where: { id: entry.entityId, userId },
        });
        if (!exists) continue;
        // Never resurrect a trade trashed after the logged action.
        if (exists.deletedAt && !before.deletedAt) continue;
        await tx.trade.update({
          where: { id: entry.entityId },
          data: {
            strategyId: before.strategyId,
            accountId: before.accountId,
            deletedAt: before.deletedAt ? new Date(before.deletedAt) : null,
            deletedBy: before.deletedAt ? userId : null,
            customFields:
              before.customFields && Object.keys(before.customFields).length > 0
                ? JSON.stringify(before.customFields)
                : null,
          },
        });
        // Restore the exact tag set (bulk edits may have added/removed tags).
        await tx.tradeTag.deleteMany({ where: { tradeId: entry.entityId } });
        if (before.tagIds.length > 0) {
          await tx.tradeTag.createMany({
            data: before.tagIds.map((tagId) => ({ tradeId: entry.entityId, tagId })),
            skipDuplicates: true,
          });
        }
        restoredIds.push(entry.entityId);
      }
      await tx.changeLog.updateMany({
        where: { userId, groupId },
        data: { undoneAt: now },
      });
    });
  });
  // searchText depends on tags/custom fields - refresh outside the tx.
  for (const id of restoredIds) {
    await refreshTradeSearchText(id);
  }
  return { restored: restoredIds.length };
}

/** New group id for a bulk/single action. */
export function newGroupId(): string {
  return randomUUID();
}
