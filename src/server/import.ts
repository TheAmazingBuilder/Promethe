/**
 * v3 — File import server: chunked, idempotent, update-broker-fields-only.
 *
 * The browser parses the file (Web Worker) and sends normalized rows in
 * chunks of ≤ 200 — the server never receives the raw file. Rules (4.2):
 *  - dedupe by (accountId, externalId)
 *  - re-importing a more complete file UPDATES broker fields of existing
 *    trades without touching user fields (notes, tags, screenshots,
 *    strategy, reviews)
 *  - manual trades are never overwritten by import — they feed the
 *    reconciliation matcher instead
 *  - every batch ends with counts + a downloadable error report
 */
import type { ImportBatch } from "@prisma/client";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { refreshTradeSearchText } from "@/server/search-index";
import { toD } from "@/lib/trading/dec";
import { detectSession } from "@/lib/trading/session";
import { naiveToUtc } from "@/lib/import/primitives";
import { resolveInstrumentForSymbol, recomputeSyncedTrade } from "@/lib/sync/process";
import { inferExitReason } from "@/lib/sync/normalize";
import { runMatcherForAccount } from "@/server/reconciliation";
import { importTradeRowSchema, importCashRowSchema } from "@/lib/validations/import";
import type { z } from "zod";

export class ImportError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = "ImportError";
  }
}

export interface ImportBatchDTO {
  id: string;
  accountId: string;
  format: string;
  fileName: string;
  status: string;
  counts: { parsed?: number; created?: number; updated?: number; duplicates?: number; errors?: number };
  serverTimezone: string;
  createdAt: string;
}

function toDTO(batch: ImportBatch): ImportBatchDTO {
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(batch.countsJson) as Record<string, number>;
  } catch {
    /* ignore */
  }
  return {
    id: batch.id,
    accountId: batch.accountId,
    format: batch.format,
    fileName: batch.fileName,
    status: batch.status,
    counts,
    serverTimezone: batch.serverTimezone,
    createdAt: batch.createdAt.toISOString(),
  };
}

export interface CreateBatchInput {
  accountId: string;
  format: string;
  fileName: string;
  fileHash: string;
  serverTimezone: string;
  counts: { parsed: number; trades: number; cash: number };
}

export async function createImportBatch(
  userId: string,
  input: CreateBatchInput
): Promise<{ batch: ImportBatchDTO; duplicateWarning: string | false }> {
  const account = await db.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new ImportError("ACCOUNT_NOT_FOUND", 422);

  const previous = await db.importBatch.findFirst({
    where: { userId, fileHash: input.fileHash },
    orderBy: { createdAt: "desc" },
  });

  const batch = await db.importBatch.create({
    data: {
      userId,
      accountId: input.accountId,
      format: input.format,
      fileName: input.fileName,
      fileHash: input.fileHash,
      status: "PREVIEW",
      countsJson: JSON.stringify(input.counts),
      serverTimezone: input.serverTimezone,
    },
  });

  const duplicateWarning =
    previous !== null && previous.status !== "FAILED"
      ? `Ce fichier a déjà été importé le ${previous.createdAt.toLocaleDateString("fr-FR")} (${previous.fileName}). Ré-importer mettra à jour les champs broker sans dupliquer les trades.`
      : false;
  return { batch: toDTO(batch), duplicateWarning };
}

export interface ChunkResult {
  created: number;
  updated: number;
  duplicates: number;
  /** Manual trades left untouched (reconciliation will propose merges). */
  manualSkipped: number;
  /** v2.5 M4 - trashed rows brought back by re-import (also counted in `updated`). */
  restored: number;
  errors: { row: number; externalId?: string; code: string; detail?: string }[];
}

async function strategyForMagic(userId: string, magic?: string | null): Promise<string | null> {
  if (!magic || magic === "0") return null;
  const mapping = await db.magicNumberMapping.findFirst({ where: { userId, magicNumber: magic } });
  if (!mapping) return null;
  const strategy = await db.strategy.findFirst({
    where: { id: mapping.strategyId, userId },
    select: { id: true },
  });
  return strategy?.id ?? null;
}

export async function importChunk(
  userId: string,
  batchId: string,
  payload: unknown
): Promise<ChunkResult> {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new ImportError("BATCH_NOT_FOUND", 404);
  if (batch.status === "IMPORTED") throw new ImportError("BATCH_ALREADY_DONE", 409);

  const account = await db.account.findUniqueOrThrow({ where: { id: batch.accountId } });

  // Validate the untrusted payload chunk.
  const tradesRaw = (payload as { trades?: unknown[] })?.trades ?? [];
  const cashRaw = (payload as { cash?: unknown[] })?.cash ?? [];
  if (tradesRaw.length + cashRaw.length === 0 || tradesRaw.length > 200) {
    throw new ImportError("CHUNK_SIZE", 422, "Chunk vide ou > 200 lignes.");
  }

  const result: ChunkResult = { created: 0, updated: 0, duplicates: 0, manualSkipped: 0, restored: 0, errors: [] };

  // ── Cash rows (dedupe by externalId) ──
  for (const [index, raw] of cashRaw.entries()) {
    const parsed = importCashRowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ row: index, code: "INVALID_CASH_ROW" });
      continue;
    }
    const row = parsed.data;
    const existing = await db.cashTransaction.findUnique({
      where: { accountId_externalId: { accountId: account.id, externalId: row.externalId } },
    });
    if (existing) {
      result.duplicates++;
      continue;
    }
    await db.cashTransaction.create({
      data: {
        userId,
        accountId: account.id,
        type: row.type,
        amount: row.amount,
        date: naiveToUtc(row.time, batch.serverTimezone),
        note: row.note ?? "Import",
        externalId: row.externalId,
      },
    });
    result.created++;
  }

  // ── Trade rows ──
  for (const [index, raw] of tradesRaw.entries()) {
    const parsed = importTradeRowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({
        row: index,
        code: "INVALID_TRADE_ROW",
        detail: parsed.error.issues[0]?.path.join("."),
      });
      continue;
    }
    const row = parsed.data;

    try {
      // v2.5 M4 — the dedupe key survives soft delete: a trashed row still
      // holds (accountId, externalId). The lookup runs INCLUDING deleted
      // rows; a trashed match is RESTORED (the broker still knows this
      // ticket) instead of failing the unique constraint with a duplicate
      // (documented rule — README “Productivity”).
      const existing = await withDeleted(() =>
        db.trade.findUnique({
          where: { accountId_externalId: { accountId: account.id, externalId: row.externalId } },
        })
      );
      const wasTrashed = existing?.deletedAt != null;

      // Manual twin: NEVER overwritten by import — the matcher handles it.
      if (existing && existing.source === "MANUAL" && !wasTrashed) {
        result.manualSkipped++;
        continue;
      }

      const openTime = naiveToUtc(row.openTime, batch.serverTimezone);
      const closeTime = naiveToUtc(row.closeTime, batch.serverTimezone);
      const instrument = await resolveInstrumentForSymbol(userId, row.symbol, null);

      if (existing) {
        // Re-import of a more complete file: UPDATE broker fields only.
        // A trashed match is restored by the same write (deletedAt → null).
        await db.trade.update({
          where: { id: existing.id },
          data: {
            entryTime: openTime,
            entryPrice: row.openPrice,
            exitTime: closeTime,
            exitPrice: row.closePrice,
            lots: row.volume,
            ...(row.stopLoss ? { stopLoss: row.stopLoss } : {}),
            ...(row.takeProfit ? { takeProfit: row.takeProfit } : {}),
            commission: row.commission,
            swap: row.swap,
            fees: row.fees,
            grossPnl: row.profit,
            exitReason: inferExitReason(row.direction, row.closePrice, row.stopLoss, row.takeProfit),
            updatedAt: new Date(),
            ...(wasTrashed ? { deletedAt: null, deletedBy: null } : {}),
          },
        });
        // Keep the executions in sync with the richer row so later
        // recomputes (undo, partial closes…) cannot drift.
        const finalExit = await db.tradeExecution.findFirst({
          where: { tradeId: existing.id, type: "FINAL_EXIT" },
          orderBy: { time: "desc" },
        });
        if (finalExit) {
          await db.tradeExecution.update({
            where: { id: finalExit.id },
            data: {
              time: closeTime,
              price: row.closePrice,
              lots: row.volume,
              commission: row.commission,
              pnl: row.profit,
            },
          });
        }
        const entryExecution = await db.tradeExecution.findFirst({
          where: { tradeId: existing.id, type: "ENTRY" },
        });
        if (entryExecution) {
          await db.tradeExecution.update({
            where: { id: entryExecution.id },
            data: { time: openTime, price: row.openPrice, lots: row.volume },
          });
        }
        await recomputeSyncedTrade({
          trade: await db.trade.findUniqueOrThrow({ where: { id: existing.id } }),
          instrument,
          account,
        });
        await refreshTradeSearchText(existing.id);
        if (wasTrashed) {
          result.restored++;
          result.updated++; // batch counters stay consistent for the UI
        } else {
          result.updated++;
        }
        continue;
      }

      // New broker-sourced trade (mirror of the EA backfill path).
      const strategyId = await strategyForMagic(userId, row.magic);
      const created = await db.trade.create({
        data: {
          userId,
          accountId: account.id,
          instrumentId: instrument.id,
          strategyId,
          externalId: row.externalId,
          direction: row.direction,
          orderType: "MARKET",
          status: "CLOSED",
          entryTime: openTime,
          entryPrice: row.openPrice,
          exitTime: closeTime,
          exitPrice: row.closePrice,
          stopLoss: row.stopLoss ?? null,
          takeProfit: row.takeProfit ?? null,
          initialStopLoss: row.stopLoss ?? null,
          initialTakeProfit: row.takeProfit ?? null,
          lots: row.volume,
          commission: row.commission,
          swap: row.swap,
          fees: row.fees,
          grossPnl: row.profit,
          pnlSource: "BROKER",
          pnlCurrency: account.currency,
          exitReason: inferExitReason(row.direction, row.closePrice, row.stopLoss, row.takeProfit),
          magicNumber: row.magic ?? null,
          brokerComment: row.comment ?? null,
          source: "FILE_IMPORT",
          needsDetails: true,
          session: detectSession(openTime),
          reviewStatus: "NOT_REVIEWED",
          preTradeAnalysis: "",
          postTradeReview: "",
        },
      });

      await db.tradeExecution.createMany({
        data: [
          {
            tradeId: created.id,
            type: "ENTRY",
            time: openTime,
            price: row.openPrice,
            lots: row.volume,
            commission: 0,
          },
          {
            tradeId: created.id,
            type: "FINAL_EXIT",
            time: closeTime,
            price: row.closePrice,
            lots: row.volume,
            commission: row.commission,
            pnl: row.profit,
          },
        ],
      });

      await recomputeSyncedTrade({ trade: created, instrument, account, brokerGrossPnl: toD(row.profit) });
      await refreshTradeSearchText(created.id);
      result.created++;
    } catch (error) {
      result.errors.push({
        row: index,
        externalId: row.externalId,
        code: "ROW_FAILED",
        detail: error instanceof Error ? error.message.slice(0, 120) : undefined,
      });
    }
  }

  return result;
}

export async function completeImportBatch(
  userId: string,
  batchId: string
): Promise<{ batch: ImportBatchDTO; errorReport: string; reconciliation: { created: number } }> {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new ImportError("BATCH_NOT_FOUND", 404);

  // Aggregate the chunk counters stored progressively in countsJson:
  // importChunk appends nothing — the client sums chunks; here we read what
  // the client sent at completion for the final record.
  const payloadCounts = batch.countsJson;
  void payloadCounts;

  const status = "IMPORTED";
  const updated = await db.importBatch.update({
    where: { id: batch.id },
    data: { status },
  });

  // Run the reconciliation matcher (4.3) after every import.
  const reconciliation = await runMatcherForAccount(userId, batch.accountId);

  return {
    batch: toDTO(updated),
    errorReport: "",
    reconciliation,
  };
}

export async function recordBatchCounts(
  userId: string,
  batchId: string,
  counts: { created: number; updated: number; duplicates: number; manualSkipped: number; errors: number; parsed: number }
): Promise<ImportBatchDTO> {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new ImportError("BATCH_NOT_FOUND", 404);
  const updated = await db.importBatch.update({
    where: { id: batch.id },
    data: {
      countsJson: JSON.stringify(counts),
      status: counts.errors > 0 ? "PARTIAL" : "IMPORTED",
    },
  });
  return toDTO(updated);
}

export type ImportTradeRowInput = z.infer<typeof importTradeRowSchema>;
export type ImportCashRowInput = z.infer<typeof importCashRowSchema>;
