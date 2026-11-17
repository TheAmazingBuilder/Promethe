/**
 * v3 — Reconciliation server: matcher runner, merge (transactional, with
 * 30-day undo snapshots) and undo (v3 §4.3).
 *
 * Merge rules: broker-sourced data wins for externalId, positionId, prices,
 * times, lots, executions, costs, net P&L, final SL/TP. User-entered data
 * wins for strategy, tags, notes, emotions, ratings, checklist,
 * screenshots, planned initial SL/TP, reviews, comments, share links,
 * event links. ALL surviving child rows are re-pointed to the surviving
 * (broker) trade; the absorbed trade + children are snapshotted for undo.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import {
  DEFAULT_MATCHER_CONFIG,
  findCandidates,
  highConfidencePairs,
  type MatcherConfig,
} from "@/lib/reconciliation/matcher";
import { recomputeSyncedTrade } from "@/lib/sync/process";

export class ReconciliationError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = "ReconciliationError";
  }
}

// ── Matcher runner ──────────────────────────────────────────────────────────

/** Creates PENDING candidates for manual↔broker pairs in an account. */
export async function runMatcherForAccount(
  userId: string,
  accountId: string,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG
): Promise<{ created: number }> {
  const account = await db.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new ReconciliationError("ACCOUNT_NOT_FOUND", 422);

  const [manualTrades, brokerTrades] = await Promise.all([
    db.trade.findMany({
      where: { accountId, source: "MANUAL", isDraft: false, status: "CLOSED" },
    }),
    db.trade.findMany({
      where: { accountId, source: { in: ["EA_SYNC", "FILE_IMPORT"] }, status: "CLOSED" },
    }),
  ]);

  // Already-resolved pairs never reappear.
  const existing = await db.reconciliationCandidate.findMany({
    where: { userId, accountId },
    select: { manualTradeId: true, brokerTradeId: true },
  });
  const known = new Set(existing.map((candidate) => `${candidate.manualTradeId}:${candidate.brokerTradeId}`));

  const instruments = await db.instrument.findMany({
    where: { id: { in: [...new Set([...manualTrades, ...brokerTrades].map((t) => t.instrumentId))] } },
    select: { id: true, pipSize: true },
  });
  const pipSizeOf = new Map(instruments.map((instrument) => [instrument.id, instrument.pipSize.toString()]));

  const pairs = findCandidates(
    manualTrades.map((trade) => ({
      id: trade.id,
      instrumentId: trade.instrumentId,
      direction: trade.direction,
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      lots: trade.lots,
      externalId: trade.externalId,
    })),
    brokerTrades.map((trade) => ({
      id: trade.id,
      instrumentId: trade.instrumentId,
      direction: trade.direction,
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      lots: trade.lots,
      externalId: trade.externalId,
    })),
    config,
    (instrumentId) => pipSizeOf.get(instrumentId) ?? "0.0001"
  );

  let created = 0;
  for (const pair of pairs) {
    const key = `${pair.manual.id}:${pair.broker.id}`;
    if (known.has(key)) continue;
    try {
      await db.reconciliationCandidate.create({
        data: {
          userId,
          accountId,
          manualTradeId: pair.manual.id,
          brokerTradeId: pair.broker.id,
          score: toD(pair.score).toDecimalPlaces(4),
          reasonsJson: JSON.stringify(pair.reasons),
        },
      });
      created++;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue; // concurrent creation - fine
      }
      throw error;
    }
  }

  return { created };
}

// ── Listing ─────────────────────────────────────────────────────────────────

export interface CandidateDTO {
  id: string;
  score: string;
  reasons: { code: string; weight: number; detail?: string }[];
  status: string;
  manual: {
    id: string;
    symbol: string;
    direction: string;
    entryTime: string;
    entryPrice: string;
    exitTime: string | null;
    exitPrice: string | null;
    lots: string;
    strategyName: string | null;
    hasNotes: boolean;
    screenshotCount: number;
    tagCount: number;
  };
  broker: {
    id: string;
    symbol: string;
    direction: string;
    entryTime: string;
    entryPrice: string;
    exitTime: string | null;
    exitPrice: string | null;
    lots: string;
    netPnl: string | null;
    pips: string | null;
    source: string;
  };
  createdAt: string;
}

export async function listCandidates(
  userId: string,
  filters: { accountId?: string; status?: string }
): Promise<CandidateDTO[]> {
  const candidates = await db.reconciliationCandidate.findMany({
    where: {
      userId,
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      status: filters.status ?? "PENDING",
    },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  if (candidates.length === 0) return [];

  const tradeIds = candidates.flatMap((candidate) => [candidate.manualTradeId, candidate.brokerTradeId]);
  const trades = await db.trade.findMany({
    where: { id: { in: tradeIds } },
    include: {
      instrument: { select: { symbol: true } },
      strategy: { select: { name: true } },
      screenshots: { select: { id: true } },
      tags: { select: { tagId: true } },
    },
  });
  const byId = new Map(trades.map((trade) => [trade.id, trade]));

  const dtos: CandidateDTO[] = [];
  for (const candidate of candidates) {
    const manual = byId.get(candidate.manualTradeId);
    const broker = byId.get(candidate.brokerTradeId);
    // Resolved pairs whose trades were merged away disappear silently.
    if (!manual || !broker) continue;
    let reasons: { code: string; weight: number; detail?: string }[] = [];
    try {
      reasons = JSON.parse(candidate.reasonsJson) as typeof reasons;
    } catch {
      /* ignore */
    }
    dtos.push({
      id: candidate.id,
      score: candidate.score.toString(),
      reasons,
      status: candidate.status,
      manual: {
        id: manual.id,
        symbol: manual.instrument.symbol,
        direction: manual.direction,
        entryTime: manual.entryTime.toISOString(),
        entryPrice: manual.entryPrice.toString(),
        exitTime: manual.exitTime?.toISOString() ?? null,
        exitPrice: manual.exitPrice?.toString() ?? null,
        lots: manual.lots.toString(),
        strategyName: manual.strategy?.name ?? null,
        hasNotes: Boolean(manual.notes || manual.preTradeAnalysis || manual.postTradeReview),
        screenshotCount: manual.screenshots.length,
        tagCount: manual.tags.length,
      },
      broker: {
        id: broker.id,
        symbol: broker.instrument.symbol,
        direction: broker.direction,
        entryTime: broker.entryTime.toISOString(),
        entryPrice: broker.entryPrice.toString(),
        exitTime: broker.exitTime?.toISOString() ?? null,
        exitPrice: broker.exitPrice?.toString() ?? null,
        lots: broker.lots.toString(),
        netPnl: broker.netPnl?.toString() ?? null,
        pips: broker.pips?.toString() ?? null,
        source: broker.source,
      },
      createdAt: candidate.createdAt.toISOString(),
    });
  }
  return dtos;
}

export async function countPendingCandidates(userId: string): Promise<number> {
  return db.reconciliationCandidate.count({ where: { userId, status: "PENDING" } });
}

// ── Merge ───────────────────────────────────────────────────────────────────

interface MergeSnapshot {
  absorbed: {
    trade: Record<string, unknown>;
    executions: Record<string, unknown>[];
    tags: { tagId: string }[];
    screenshotIds: string[];
    reviewExisted: boolean;
    eventLinkIds: string[];
    marketContextId: string | null;
    shareLinkIds: string[];
    modificationIds: string[];
  };
  survivorBefore: Record<string, unknown>;
}

export async function mergeCandidate(
  userId: string,
  candidateId: string
): Promise<{ survivingTradeId: string; mergeLogId: string }> {
  const candidate = await db.reconciliationCandidate.findFirst({
    where: { id: candidateId, userId, status: "PENDING" },
  });
  if (!candidate) throw new ReconciliationError("CANDIDATE_NOT_FOUND", 404);

  return db.$transaction(async (tx) => {
    const manual = await tx.trade.findFirst({
      where: { id: candidate.manualTradeId, userId },
    });
    const broker = await tx.trade.findFirst({
      where: { id: candidate.brokerTradeId, userId },
    });
    if (!manual || !broker) {
      throw new ReconciliationError("TRADES_NOT_FOUND", 404);
    }

    // ── Snapshot the absorbed side (for undo ≤ 30 days) ──
    const [executions, tags, screenshots, review, eventLinks, marketContext, shareLinks, modifications] =
      await Promise.all([
        tx.tradeExecution.findMany({ where: { tradeId: manual.id } }),
        tx.tradeTag.findMany({ where: { tradeId: manual.id } }),
        tx.tradeScreenshot.findMany({ where: { tradeId: manual.id } }),
        tx.tradeReview.findFirst({ where: { tradeId: manual.id } }),
        tx.tradeEventLink.findMany({ where: { tradeId: manual.id } }),
        tx.marketContextSnapshot.findFirst({ where: { tradeId: manual.id } }),
        tx.shareLink.findMany({ where: { targetId: manual.id, type: "TRADE" } }),
        tx.tradeModification.findMany({ where: { tradeId: manual.id } }),
      ]);

    const snapshot: MergeSnapshot = {
      absorbed: {
        trade: manual as unknown as Record<string, unknown>,
        executions: executions as unknown as Record<string, unknown>[],
        tags: tags.map((tag) => ({ tagId: tag.tagId })),
        screenshotIds: screenshots.map((shot) => shot.id),
        reviewExisted: review !== null,
        eventLinkIds: eventLinks.map((link) => link.id),
        marketContextId: marketContext?.id ?? null,
        shareLinkIds: shareLinks.map((link) => link.id),
        modificationIds: modifications.map((modification) => modification.id),
      },
      survivorBefore: broker as unknown as Record<string, unknown>,
    };

    // ── User fields from the MANUAL side WIN (v3 §4.3: "merging keeps user
    // notes/screenshots/strategy with broker prices/P&L") — the manual trade
    // IS the user's journal; the synced copy is the broker's numbers. ──
    const survivorUpdate: Prisma.TradeUpdateInput = {};
    if (manual.strategyId) survivorUpdate.strategy = { connect: { id: manual.strategyId } };
    if (manual.notes) survivorUpdate.notes = manual.notes;
    if (manual.preTradeAnalysis?.trim()) survivorUpdate.preTradeAnalysis = manual.preTradeAnalysis;
    if (manual.postTradeReview?.trim()) survivorUpdate.postTradeReview = manual.postTradeReview;
    if (manual.initialStopLoss)
      survivorUpdate.initialStopLoss = manual.initialStopLoss; // planned SL the user entered
    if (manual.initialTakeProfit)
      survivorUpdate.initialTakeProfit = manual.initialTakeProfit;
    if (manual.emotionBefore) survivorUpdate.emotionBefore = manual.emotionBefore;
    if (manual.emotionDuring) survivorUpdate.emotionDuring = manual.emotionDuring;
    if (manual.emotionAfter) survivorUpdate.emotionAfter = manual.emotionAfter;
    if (manual.confidence !== null) survivorUpdate.confidence = manual.confidence;
    if (manual.setupQualityRating !== null) survivorUpdate.setupQualityRating = manual.setupQualityRating;
    if (manual.executionRating !== null) survivorUpdate.executionRating = manual.executionRating;
    if (manual.followedPlan !== null) survivorUpdate.followedPlan = manual.followedPlan;
    if (manual.lessonLearned) survivorUpdate.lessonLearned = manual.lessonLearned;
    if (manual.timeframe) survivorUpdate.timeframe = manual.timeframe;
    if (manual.setupType) survivorUpdate.setupType = manual.setupType;
    if (manual.marketCondition) survivorUpdate.marketCondition = manual.marketCondition;
    if (manual.tradingViewUrl) survivorUpdate.tradingViewUrl = manual.tradingViewUrl;
    if (manual.checklistResults) survivorUpdate.checklistResults = manual.checklistResults;
    if (manual.reviewStatus === "REVIEWED") survivorUpdate.reviewStatus = "REVIEWED";
    survivorUpdate.needsDetails = false; // the user's details now live here

    if (Object.keys(survivorUpdate).length > 0) {
      await tx.trade.update({ where: { id: broker.id }, data: survivorUpdate });
    }

    // ── Re-point ALL surviving child rows to the survivor ──
    if (screenshots.length > 0) {
      await tx.tradeScreenshot.updateMany({
        where: { tradeId: manual.id },
        data: { tradeId: broker.id },
      });
    }
    for (const tag of tags) {
      await tx.tradeTag
        .upsert({
          where: { tradeId_tagId: { tradeId: broker.id, tagId: tag.tagId } },
          update: {},
          create: { tradeId: broker.id, tagId: tag.tagId },
        })
        .catch(() => undefined);
    }
    if (review) {
      const brokerReview = await tx.tradeReview.findFirst({ where: { tradeId: broker.id } });
      if (!brokerReview) {
        await tx.tradeReview.updateMany({ where: { tradeId: manual.id }, data: { tradeId: broker.id } });
      }
    }
    if (eventLinks.length > 0) {
      await tx.tradeEventLink.updateMany({ where: { tradeId: manual.id }, data: { tradeId: broker.id } });
    }
    if (marketContext) {
      const brokerContext = await tx.marketContextSnapshot.findFirst({ where: { tradeId: broker.id } });
      if (!brokerContext) {
        await tx.marketContextSnapshot.updateMany({ where: { tradeId: manual.id }, data: { tradeId: broker.id } });
      }
    }
    if (shareLinks.length > 0) {
      await tx.shareLink.updateMany({
        where: { id: { in: shareLinks.map((link) => link.id) } },
        data: { targetId: broker.id },
      });
    }
    if (modifications.length > 0) {
      await tx.tradeModification.updateMany({ where: { tradeId: manual.id }, data: { tradeId: broker.id } });
    }

    // ── Executions: broker wins — delete the manual ones (snapshotted) ──
    await tx.tradeExecution.deleteMany({ where: { tradeId: manual.id } });

    // ── Delete the absorbed trade ──
    await tx.trade.delete({ where: { id: manual.id } });

    // ── Mark the candidate + write the undo log ──
    await tx.reconciliationCandidate.update({
      where: { id: candidate.id },
      data: { status: "MERGED", resolvedAt: new Date() },
    });
    const mergeLog = await tx.tradeMergeLog.create({
      data: {
        userId,
        survivingTradeId: broker.id,
        absorbedTradeSnapshot: JSON.stringify(snapshot),
        fieldChoicesJson: JSON.stringify({ rule: "broker-prices-user-journal" }),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    return { survivingTradeId: broker.id, mergeLogId: mergeLog.id };
  }, { timeout: 20_000 });
}

export async function resolveCandidate(
  userId: string,
  candidateId: string,
  action: "REJECT" | "KEEP_SEPARATE"
): Promise<void> {
  const status = action === "REJECT" ? "REJECTED_NOT_DUPLICATE" : "KEPT_SEPARATE";
  const updated = await db.reconciliationCandidate.updateMany({
    where: { id: candidateId, userId, status: "PENDING" },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count === 0) throw new ReconciliationError("CANDIDATE_NOT_FOUND", 404);
}

export async function bulkMergeHighConfidence(userId: string): Promise<{ merged: number }> {
  const candidates = await db.reconciliationCandidate.findMany({
    where: { userId, status: "PENDING" },
  });
  if (candidates.length === 0) return { merged: 0 };

  // Group by broker trade: auto-merge only with EXACTLY ONE candidate ≥ 0.9.
  const byBroker = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byBroker.get(candidate.brokerTradeId) ?? [];
    list.push(candidate);
    byBroker.set(candidate.brokerTradeId, list);
  }

  let merged = 0;
  for (const list of byBroker.values()) {
    if (list.length === 1 && Number(list[0]!.score) >= DEFAULT_MATCHER_CONFIG.autoMergeScore) {
      try {
        await mergeCandidate(userId, list[0]!.id);
        merged++;
      } catch (error) {
        console.error("[reconciliation] auto-merge failed:", error);
      }
    }
  }
  return { merged };
}

// ── Undo ────────────────────────────────────────────────────────────────────

export async function undoMerge(userId: string, mergeLogId: string): Promise<{ restoredTradeId: string }> {
  const log = await db.tradeMergeLog.findFirst({
    where: { id: mergeLogId, userId, undoneAt: null },
  });
  if (!log) throw new ReconciliationError("MERGE_LOG_NOT_FOUND", 404);
  if (log.expiresAt.getTime() < Date.now()) {
    throw new ReconciliationError("MERGE_UNDO_EXPIRED", 410, "Undo disponible 30 jours.");
  }

  const snapshot = JSON.parse(log.absorbedTradeSnapshot) as MergeSnapshot;
  const absorbed = snapshot.absorbed.trade as unknown as {
    id: string;
    userId: string;
    accountId: string;
    instrumentId: string;
    [key: string]: unknown;
  };

  return db.$transaction(async (tx) => {
    // ── Restore the survivor's pre-merge fields ──
    await tx.trade.update({
      where: { id: log.survivingTradeId },
      data: snapshot.survivorBefore as Prisma.TradeUpdateInput,
    });

    // ── Recreate the absorbed trade + executions FIRST (children FKs) ──
    // The trade row was deleted by the merge — recreate from the snapshot
    // minus auto-generated fields.
    const { id, createdAt, updatedAt, ...tradeData } = absorbed as Record<string, unknown>;
    void createdAt; void updatedAt;
    await tx.trade.create({
      data: {
        ...(tradeData as Prisma.TradeUncheckedCreateInput),
        id: id as string,
        userId,
      },
    });
    if (snapshot.absorbed.executions.length > 0) {
      await tx.tradeExecution.createMany({
        data: snapshot.absorbed.executions as unknown as Prisma.TradeExecutionCreateManyInput[],
      });
    }

    // ── Move re-pointed children back ──
    if (snapshot.absorbed.screenshotIds.length > 0) {
      await tx.tradeScreenshot.updateMany({
        where: { id: { in: snapshot.absorbed.screenshotIds } },
        data: { tradeId: absorbed.id },
      });
    }
    for (const tag of snapshot.absorbed.tags) {
      await tx.tradeTag
        .upsert({
          where: { tradeId_tagId: { tradeId: absorbed.id, tagId: tag.tagId } },
          update: {},
          create: { tradeId: absorbed.id, tagId: tag.tagId },
        })
        .catch(() => undefined);
      await tx.tradeTag.deleteMany({
        where: { tradeId: log.survivingTradeId, tagId: tag.tagId },
      }).catch(() => undefined);
    }
    if (snapshot.absorbed.reviewExisted) {
      await tx.tradeReview.updateMany({
        where: { tradeId: log.survivingTradeId },
        data: { tradeId: absorbed.id },
      }).catch(() => undefined);
    }
    if (snapshot.absorbed.eventLinkIds.length > 0) {
      await tx.tradeEventLink.updateMany({
        where: { id: { in: snapshot.absorbed.eventLinkIds } },
        data: { tradeId: absorbed.id },
      });
    }
    if (snapshot.absorbed.marketContextId) {
      await tx.marketContextSnapshot.updateMany({
        where: { id: snapshot.absorbed.marketContextId },
        data: { tradeId: absorbed.id },
      }).catch(() => undefined);
    }
    if (snapshot.absorbed.shareLinkIds.length > 0) {
      await tx.shareLink.updateMany({
        where: { id: { in: snapshot.absorbed.shareLinkIds } },
        data: { targetId: absorbed.id },
      });
    }
    if (snapshot.absorbed.modificationIds.length > 0) {
      await tx.tradeModification.updateMany({
        where: { id: { in: snapshot.absorbed.modificationIds } },
        data: { tradeId: absorbed.id },
      });
    }

    // ── Recompute both trades' derived values ──
    const survivor = await tx.trade.findUniqueOrThrow({ where: { id: log.survivingTradeId } });
    const instrument = await tx.instrument.findUniqueOrThrow({ where: { id: survivor.instrumentId } });
    const account = await tx.account.findUniqueOrThrow({ where: { id: survivor.accountId } });
    await recomputeSyncedTrade({ trade: survivor, instrument, account, tx });

    // ── Reopen the candidate + mark the log undone ──
    await tx.reconciliationCandidate.updateMany({
      where: { brokerTradeId: log.survivingTradeId, status: "MERGED" },
      data: { status: "PENDING", resolvedAt: null },
    });
    await tx.tradeMergeLog.update({
      where: { id: log.id },
      data: { undoneAt: new Date() },
    });

    return { restoredTradeId: absorbed.id };
  }, { timeout: 20_000 });
}

export async function listMergeLogs(userId: string): Promise<
  { id: string; survivingTradeId: string; mergedAt: string; expiresAt: string; undoneAt: string | null }[]
> {
  const logs = await db.tradeMergeLog.findMany({
    where: { userId, undoneAt: null, expiresAt: { gt: new Date() } },
    orderBy: { mergedAt: "desc" },
    take: 50,
  });
  return logs.map((log) => ({
    id: log.id,
    survivingTradeId: log.survivingTradeId,
    mergedAt: log.mergedAt.toISOString(),
    expiresAt: log.expiresAt.toISOString(),
    undoneAt: log.undoneAt?.toISOString() ?? null,
  }));
}

export { highConfidencePairs };
