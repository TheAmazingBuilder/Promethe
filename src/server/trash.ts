/**
 * Trash (v2.5 Module 4 §4.6) — server-side data access.
 *
 * Soft-deleted rows (deletedAt set) are invisible to every default read
 * through the Prisma client extension. This module is one of the two
 * authorized `withDeleted` consumers (the other is the import/sync
 * dedupe): it lists, restores, permanently deletes and purges trashed
 * items, always scoped by userId.
 *
 * Retention: 30 days, enforced by the daily maintenance cron
 * (purgeExpiredTrash) which also removes Storage objects and prunes the
 * ChangeLog (Phase 2).
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import {
  TRASH_ENTITIES,
  TRASH_RETENTION_DAYS,
  ENTITY_TO_MODEL,
  type TrashEntity,
} from "@/lib/trash/constants";
import { foldText } from "@/lib/search/text";
import { UPLOAD_ROOT } from "@/server/uploads";

export interface TrashItemDTO {
  id: string;
  entity: TrashEntity;
  /** Display label — symbol+direction for trades, name for the rest. */
  title: string;
  /** Secondary line — date, strategy… (nullable). */
  subtitle: string | null;
  deletedAt: string;
  /** Whole days left before the daily cron purges the item. */
  daysRemaining: number;
}

export interface TrashCounts {
  TRADE: number;
  JOURNAL_ENTRY: number;
  STRATEGY: number;
  TAG: number;
  total: number;
}

export interface TrashListResult {
  items: TrashItemDTO[];
  counts: TrashCounts;
}

export interface TrashItemRef {
  entity: TrashEntity;
  id: string;
}

function daysRemaining(deletedAt: Date, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - deletedAt.getTime());
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor(elapsed / 86_400_000));
}

/** Row → display item (per-entity title/subtitle). */
function toTrashItem(entity: TrashEntity, row: TrashRow): TrashItemDTO {
  const title =
    entity === "TRADE"
      ? `${row.symbol ?? "?"} ${row.direction === "SHORT" ? "▾" : "▴"}`
      : (row.name ?? row.date ?? "?");
  const subtitle =
    entity === "TRADE"
      ? row.entryTime
        ? new Date(row.entryTime).toLocaleDateString("en-CA")
        : null
      : entity === "JOURNAL_ENTRY"
        ? (row.date ?? null)
        : null;
  return {
    id: row.id,
    entity,
    title,
    subtitle,
    deletedAt: row.deletedAt.toISOString(),
    daysRemaining: daysRemaining(row.deletedAt, new Date()),
  };
}

/** Minimal projection of a trashed row (union of the 4 models). */
interface TrashRow {
  id: string;
  deletedAt: Date;
  symbol?: string | null;
  direction?: string | null;
  entryTime?: Date | string | null;
  name?: string | null;
  date?: string | null;
}

/** List trashed items (optionally one entity / filtered by folded search). */
export async function listTrash(
  userId: string,
  options: { entity?: TrashEntity | null; search?: string | null; limit?: number } = {}
): Promise<TrashListResult> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const folded = options.search ? foldText(options.search.trim()) : null;
  const like = folded && folded.length > 0 ? { contains: folded } : null;

  const result = await withDeleted(async () => {
    const entities = options.entity ? [options.entity] : [...TRASH_ENTITIES];
    const perEntity = await Promise.all(
      entities.map(async (entity) => {
        const model = ENTITY_TO_MODEL[entity];
        // One typed query per model — the shapes differ but the projection
        // is normalized right after.
        if (entity === "TRADE") {
          const rows = await db.trade.findMany({
            where: {
              userId,
              deletedAt: { not: null },
              ...(like
                ? {
                    OR: [
                      { searchText: like },
                      { notes: like },
                      { setupType: like },
                    ],
                  }
                : {}),
            },
            include: { instrument: { select: { symbol: true } } },
            orderBy: { deletedAt: "desc" },
            take: limit,
          });
          return rows.map((r) =>
            toTrashItem("TRADE", {
              id: r.id,
              deletedAt: r.deletedAt as Date,
              symbol: r.instrument.symbol,
              direction: r.direction,
              entryTime: r.entryTime,
            })
          );
        }
        if (entity === "JOURNAL_ENTRY") {
          const rows = await db.journalEntry.findMany({
            where: {
              userId,
              deletedAt: { not: null },
              ...(like ? { OR: [{ searchText: like }, { keyLesson: like }] } : {}),
            },
            orderBy: { deletedAt: "desc" },
            take: limit,
          });
          return rows.map((r) =>
            toTrashItem("JOURNAL_ENTRY", {
              id: r.id,
              deletedAt: r.deletedAt as Date,
              date: r.date,
            })
          );
        }
        if (entity === "STRATEGY") {
          const rows = await db.strategy.findMany({
            where: {
              userId,
              deletedAt: { not: null },
              ...(like ? { OR: [{ searchText: like }, { name: like }] } : {}),
            },
            orderBy: { deletedAt: "desc" },
            take: limit,
          });
          return rows.map((r) =>
            toTrashItem("STRATEGY", {
              id: r.id,
              deletedAt: r.deletedAt as Date,
              name: r.name,
            })
          );
        }
        const rows = await db.tag.findMany({
          where: {
            userId,
            deletedAt: { not: null },
            ...(like ? { name: like } : {}),
          },
          orderBy: { deletedAt: "desc" },
          take: limit,
        });
        return rows.map((r) =>
          toTrashItem("TAG", {
            id: r.id,
            deletedAt: r.deletedAt as Date,
            name: r.name,
          })
        );
      })
    );
    return perEntity.flat();
  });

  // Counts across ALL entities (independent of the active filter).
  const counts = await trashCounts(userId);

  const items = result.sort(
    (a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)
  );
  return { items, counts };
}

/** Number of trashed items per entity for the current user. */
export async function trashCounts(userId: string): Promise<TrashCounts> {
  return withDeleted(async () => {
    const [trade, journalEntry, strategy, tag] = await Promise.all([
      db.trade.count({ where: { userId, deletedAt: { not: null } } }),
      db.journalEntry.count({ where: { userId, deletedAt: { not: null } } }),
      db.strategy.count({ where: { userId, deletedAt: { not: null } } }),
      db.tag.count({ where: { userId, deletedAt: { not: null } } }),
    ]);
    return {
      TRADE: trade,
      JOURNAL_ENTRY: journalEntry,
      STRATEGY: strategy,
      TAG: tag,
      total: trade + journalEntry + strategy + tag,
    } satisfies TrashCounts;
  });
}

/** Restore soft-deleted items (ownership verified per id). */
export async function restoreTrashItems(
  userId: string,
  refs: TrashItemRef[]
): Promise<{ restored: number }> {
  let restored = 0;
  await withDeleted(async () => {
    for (const ref of refs) {
      const model = ENTITY_TO_MODEL[ref.entity];
      if (model === "trade") {
        const r = await db.trade.updateMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
          data: { deletedAt: null, deletedBy: null },
        });
        restored += r.count;
      } else if (model === "journalEntry") {
        const r = await db.journalEntry.updateMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
          data: { deletedAt: null, deletedBy: null },
        });
        restored += r.count;
      } else if (model === "strategy") {
        const r = await db.strategy.updateMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
          data: { deletedAt: null, deletedBy: null },
        });
        restored += r.count;
      } else {
        const r = await db.tag.updateMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
          data: { deletedAt: null, deletedBy: null },
        });
        restored += r.count;
      }
    }
  });
  return { restored };
}

/** Remove the trade's screenshot rows + the uploads/{userId}/{tradeId} dir. */
async function purgeTradeStorage(userId: string, tradeIds: string[]): Promise<void> {
  if (tradeIds.length === 0) return;
  await db.tradeScreenshot.deleteMany({
    where: { tradeId: { in: tradeIds } },
  });
  await Promise.all(
    tradeIds.map((tradeId) =>
      rm(path.join(UPLOAD_ROOT, userId, tradeId), {
        recursive: true,
        force: true,
      }).catch(() => undefined)
    )
  );
}

/**
 * Permanently delete soft-deleted items (ownership verified per id).
 * Trades take their children (executions, tags, screenshots, reviews,
 * violations) via FK cascades; screenshot files are removed from storage.
 */
export async function deleteTrashItemsPermanently(
  userId: string,
  refs: TrashItemRef[]
): Promise<{ deleted: number }> {
  let deleted = 0;
  const tradeIds: string[] = [];
  await withDeleted(async () => {
    for (const ref of refs) {
      const model = ENTITY_TO_MODEL[ref.entity];
      if (model === "trade") {
        const r = await db.trade.deleteMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
        });
        if (r.count > 0) {
          deleted += r.count;
          tradeIds.push(ref.id);
        }
      } else if (model === "journalEntry") {
        const r = await db.journalEntry.deleteMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
        });
        deleted += r.count;
      } else if (model === "strategy") {
        const r = await db.strategy.deleteMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
        });
        deleted += r.count;
      } else {
        const r = await db.tag.deleteMany({
          where: { id: ref.id, userId, deletedAt: { not: null } },
        });
        deleted += r.count;
      }
    }
  });
  await purgeTradeStorage(userId, tradeIds);
  return { deleted };
}

/** Empty the whole trash for the current user (permanent). */
export async function emptyTrash(
  userId: string
): Promise<{ deleted: number }> {
  const { items } = await listTrash(userId, { limit: 500 });
  // Chunked: the free-tier SQLite has a variable cap (999 params).
  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < items.length; i += CHUNK) {
    const r = await deleteTrashItemsPermanently(
      userId,
      items.slice(i, i + CHUNK).map((it) => ({ entity: it.entity, id: it.id }))
    );
    deleted += r.deleted;
  }
  return { deleted };
}

export interface TrashPurgeReport {
  trades: number;
  journalEntries: number;
  strategies: number;
  tags: number;
  changeLogsPruned: number;
}

/**
 * Daily cron step — permanently delete items trashed more than 30 days
 * ago (idempotent, chunked) and prune expired ChangeLog entries.
 */
export async function purgeExpiredTrash(
  now: Date = new Date()
): Promise<TrashPurgeReport> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
  const expired = { deletedAt: { not: null, lt: cutoff } };
  const CHUNK = 200;

  return withDeleted(async () => {
    // ── Trades: collect ids first (storage cleanup needs userId + tradeId) ──
    const expiredTrades: { id: string; userId: string }[] =
      await db.trade.findMany({
        where: expired,
        select: { id: true, userId: true },
        take: 500,
      });
    let trades = 0;
    for (let i = 0; i < expiredTrades.length; i += CHUNK) {
      const r = await db.trade.deleteMany({
        where: {
          id: { in: expiredTrades.slice(i, i + CHUNK).map((t) => t.id) },
        },
      });
      trades += r.count;
    }
    // Storage cleanup grouped by user (uploads/{userId}/{tradeId}).
    const byUser = new Map<string, string[]>();
    for (const t of expiredTrades) {
      const list = byUser.get(t.userId) ?? [];
      list.push(t.id);
      byUser.set(t.userId, list);
    }
    for (const [userId, ids] of byUser) {
      await purgeTradeStorage(userId, ids);
    }

    // ── Other entities: chunked find-ids → delete ──
    const purgeChunked = async (
      findIds: (take: number) => Promise<{ id: string }[]>,
      deleteIds: (ids: string[]) => Promise<number>
    ): Promise<number> => {
      let total = 0;
      for (;;) {
        const rows = await findIds(CHUNK);
        if (rows.length === 0) break;
        total += await deleteIds(rows.map((x) => x.id));
        if (rows.length < CHUNK) break;
      }
      return total;
    };

    const journalEntries = await purgeChunked(
      (take) => db.journalEntry.findMany({ where: expired, select: { id: true }, take }),
      (ids) =>
        db.journalEntry
          .deleteMany({ where: { id: { in: ids } } })
          .then((r) => r.count)
    );
    const strategies = await purgeChunked(
      (take) => db.strategy.findMany({ where: expired, select: { id: true }, take }),
      (ids) =>
        db.strategy
          .deleteMany({ where: { id: { in: ids } } })
          .then((r) => r.count)
    );
    const tags = await purgeChunked(
      (take) => db.tag.findMany({ where: expired, select: { id: true }, take }),
      (ids) => db.tag.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count)
    );

    // ── ChangeLog pruning (undo snapshots past expiry) ──
    const changeLogs = await db.changeLog.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return {
      trades,
      journalEntries,
      strategies,
      tags,
      changeLogsPruned: changeLogs.count,
    } satisfies TrashPurgeReport;
  });
}
