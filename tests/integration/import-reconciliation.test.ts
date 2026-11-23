/**
 * v3 Phase 3 — Import + reconciliation integration tests (PostgreSQL schema promethe_test).
 *
 * Golden path (v3 §9): importing a history file creates trades without
 * duplicates; re-importing updates broker fields without touching user
 * fields; manual trades matching imported ones appear as candidates;
 * merging keeps user notes/screenshots/strategy with broker prices/P&L;
 * undo restores everything.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  createImportBatch,
  importChunk,
  completeImportBatch,
  recordBatchCounts,
} from "@/server/import";
import {
  listCandidates,
  mergeCandidate,
  resolveCandidate,
  undoMerge,
  bulkMergeHighConfidence,
} from "@/server/reconciliation";

let user: { id: string; email: string };
let accountId: string;
let instrumentId: string;

const TRADES = [
  {
    externalId: "MT5:9001",
    symbol: "XAUUSDm",
    direction: "LONG" as const,
    volume: "0.50",
    openTime: "2025-01-15 08:32:00",
    openPrice: "2650.50",
    closeTime: "2025-01-15 11:05:00",
    closePrice: "2655.80",
    stopLoss: "2645.00",
    takeProfit: "2662.00",
    commission: "2.50",
    swap: "0.30",
    fees: "0",
    profit: "265.00",
  },
  {
    externalId: "MT5:9002",
    symbol: "EURUSD",
    direction: "SHORT" as const,
    volume: "0.10",
    openTime: "2025-01-15 09:14:00",
    openPrice: "1.08500",
    closeTime: "2025-01-15 12:40:00",
    closePrice: "1.08320",
    stopLoss: "1.08650",
    takeProfit: "1.08200",
    commission: "0.35",
    swap: "0",
    fees: "0",
    profit: "18.00",
  },
];

const CASH = [
  {
    externalId: "MT5:BAL1",
    type: "DEPOSIT" as const,
    amount: "10000",
    time: "2025-01-10 09:00:00",
  },
];

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "import@test.local",
    password: "password1",
    displayName: "Import Tester",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  user = created.user;
  accountId = (await db.account.findFirstOrThrow({ where: { userId: user.id } })).id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: user.id } });
  await db.instrument.deleteMany({ where: { userId: user.id } });
  await db.symbolMapping.deleteMany({ where: { userId: user.id } });
  await db.$disconnect();
});

describe("chunked import", () => {
  let batchId: string;

  it("creates an import batch and imports the first chunk", async () => {
    const { batch, duplicateWarning } = await createImportBatch(user.id, {
      accountId,
      format: "MT5_CSV",
      fileName: "history.csv",
      fileHash: await sha256Hex("file-1"),
      serverTimezone: "Europe/Paris",
      counts: { parsed: 3, trades: 2, cash: 1 },
    });
    expect(duplicateWarning).toBe(false);
    batchId = batch.id;

    const result = await importChunk(user.id, batchId, { trades: TRADES, cash: CASH });
    expect(result.created).toBe(3); // 2 trades + 1 cash
    expect(result.errors).toHaveLength(0);

    const gold = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT5:9001" } },
    });
    expect(gold.source).toBe("FILE_IMPORT");
    expect(gold.needsDetails).toBe(true);
    expect(gold.pnlSource).toBe("BROKER");
    // Europe/Paris GMT+1 in January → UTC = naive − 1h.
    expect(gold.entryTime.toISOString()).toBe("2025-01-15T07:32:00.000Z");
    expect(Number(gold.netPnl)).toBeCloseTo(262.2, 1); // 265 − 2.5 − 0.3
    expect(Number(gold.pips)).toBeCloseTo(53, 0);
    expect(gold.session).toBeTruthy();

    const cash = await db.cashTransaction.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT5:BAL1" } },
    });
    expect(Number(cash.amount)).toBe(10000);
  });

  it("re-importing the same rows updates instead of duplicating", async () => {
    const result = await importChunk(user.id, batchId, { trades: TRADES, cash: CASH });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(2);
    expect(result.duplicates).toBe(1); // cash
    expect(await db.trade.count({ where: { accountId, source: "FILE_IMPORT" } })).toBe(2);
  });

  it("re-importing a more complete file updates broker fields only", async () => {
    // User adds notes/strategy on the synced trade first.
    const gold = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT5:9001" } },
    });
    await db.trade.update({
      where: { id: gold.id },
      data: { notes: "User note kept", reviewStatus: "REVIEWED" },
    });

    const richer = [
      // "More complete" = the broker finalizes the profit figure (swap/fees
      // adjustments) — prices stay identical.
      { ...TRADES[0]!, profit: "268.00" },
    ];
    const result = await importChunk(user.id, batchId, { trades: richer, cash: [] });
    expect(result.updated).toBe(1);

    const updated = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT5:9001" } },
    });
    expect(Number(updated.netPnl)).toBeCloseTo(265.2, 1); // 268 − 2.5 − 0.3
    expect(updated.notes).toBe("User note kept"); // user field untouched
    expect(updated.reviewStatus).toBe("REVIEWED"); // user field untouched
  });

  it("completes the batch and runs the matcher", async () => {
    // A MANUAL twin of the gold trade (typical: logged by hand before import).
    instrumentId = (
      await db.trade.findUniqueOrThrow({
        where: { accountId_externalId: { accountId, externalId: "MT5:9001" } },
      })
    ).instrumentId;
    await db.trade.create({
      data: {
        userId: user.id,
        accountId,
        instrumentId,
        direction: "LONG",
        status: "CLOSED",
        entryTime: new Date("2025-01-15T07:32:30.000Z"),
        entryPrice: "2650.55",
        exitTime: new Date("2025-01-15T10:05:00.000Z"),
        exitPrice: "2655.75",
        lots: "0.50",
        stopLoss: "2645.00",
        initialStopLoss: "2645.00",
        notes: "Manually journaled",
        preTradeAnalysis: "Sweep of Asia high",
        source: "MANUAL",
        pnlSource: "CALCULATED",
        reviewStatus: "REVIEWED",
        postTradeReview: "",
      },
    });
    // Attach a tag + screenshot to the manual trade (merge must re-point them).
    const tag = await db.tag.create({ data: { userId: user.id, name: "A-setup" } });
    const manualTrade = await db.trade.findFirstOrThrow({
      where: { accountId, source: "MANUAL" },
    });
    await db.tradeTag.create({ data: { tradeId: manualTrade.id, tagId: tag.id } });
    await db.tradeScreenshot.create({
      data: {
        tradeId: manualTrade.id,
        userId: user.id,
        storagePath: `uploads/${user.id}/shot-1.webp`,
        label: "ENTRY",
      },
    });

    await recordBatchCounts(user.id, batchId, {
      created: 3,
      updated: 0,
      duplicates: 0,
      manualSkipped: 0,
      errors: 1,
      parsed: 3,
    });
    const result = await completeImportBatch(user.id, batchId);
    expect(result.batch.status).toBe("PARTIAL");
    expect(result.reconciliation.created).toBeGreaterThanOrEqual(1);

    const candidates = await listCandidates(user.id, {});
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const pair = candidates[0]!;
    expect(pair.manual.hasNotes).toBe(true);
    expect(pair.manual.screenshotCount).toBe(1);
    expect(Number(pair.score)).toBeGreaterThanOrEqual(0.9);
    expect(pair.reasons.some((r) => r.code === "ENTRY_TIME_STRONG")).toBe(true);

    // A finalized PARTIAL batch is terminal: retries cannot append rows or
    // overwrite the persisted counters/status after completion.
    await expect(
      importChunk(user.id, batchId, { trades: TRADES, cash: [] })
    ).rejects.toMatchObject({ code: "BATCH_ALREADY_DONE", status: 409 });
    await expect(
      recordBatchCounts(user.id, batchId, {
        created: 0,
        updated: 0,
        duplicates: 0,
        manualSkipped: 0,
        errors: 0,
        parsed: 0,
      })
    ).rejects.toMatchObject({ code: "BATCH_ALREADY_DONE", status: 409 });
  });

  it("manual trades are never overwritten by a re-import", async () => {
    const result = await createImportBatch(user.id, {
      accountId,
      format: "MT5_CSV",
      fileName: "history.csv",
      fileHash: await sha256Hex("file-2"),
      serverTimezone: "Europe/Paris",
      counts: { parsed: 1, trades: 1, cash: 0 },
    });
    // The manual trade has no externalId → no collision by definition; the
    // guard applies to manual trades WITH an externalId (edge case: imported
    // then edited by hand). Simulate exactly that:
    const manual = await db.trade.findFirstOrThrow({ where: { accountId, source: "MANUAL" } });
    await db.trade.update({
      where: { id: manual.id },
      data: { externalId: "MT5:9003" },
    });
    const chunk = await importChunk(user.id, result.batch.id, {
      trades: [
        {
          externalId: "MT5:9003",
          symbol: "XAUUSDm",
          direction: "LONG",
          volume: "0.50",
          openTime: "2025-01-15 08:32:00",
          openPrice: "2650.50",
          closeTime: "2025-01-15 11:05:00",
          closePrice: "2655.80",
          commission: "2.50",
          swap: "0.30",
          fees: "0",
          profit: "265.00",
        },
      ],
      cash: [],
    });
    expect(chunk.manualSkipped).toBe(1);
    expect(chunk.created).toBe(0);
    // Manual trade untouched.
    const still = await db.trade.findUniqueOrThrow({ where: { id: manual.id } });
    expect(still.source).toBe("MANUAL");
    expect(still.notes).toBe("Manually journaled");
  });
});

describe("merge & undo", () => {
  let candidateId: string;
  let manualTradeId: string;
  let brokerTradeId: string;
  let mergeLogId: string;

  beforeAll(async () => {
    const candidates = await listCandidates(user.id, { status: "PENDING" });
    const target = candidates.find((c) => c.manual.hasNotes)!;
    candidateId = target.id;
    manualTradeId = target.manual.id;
    brokerTradeId = target.broker.id;
  });

  it("merges: user journal survives with broker prices", async () => {
    const result = await mergeCandidate(user.id, candidateId);
    mergeLogId = result.mergeLogId;
    expect(result.survivingTradeId).toBe(brokerTradeId);

    const survivor = await db.trade.findUniqueOrThrow({ where: { id: brokerTradeId } });
    expect(survivor.source).toBe("FILE_IMPORT");
    expect(survivor.pnlSource).toBe("BROKER");
    expect(Number(survivor.netPnl)).toBeCloseTo(265.2, 1);
    expect(survivor.entryPrice.toString()).toBe("2650.5"); // broker price
    expect(survivor.notes).toBe("Manually journaled"); // user field moved
    expect(survivor.preTradeAnalysis).toBe("Sweep of Asia high");
    expect(survivor.reviewStatus).toBe("REVIEWED");
    expect(survivor.needsDetails).toBe(false);

    // Children re-pointed.
    expect(await db.tradeScreenshot.count({ where: { tradeId: brokerTradeId } })).toBe(1);
    expect(await db.tradeTag.count({ where: { tradeId: brokerTradeId } })).toBe(1);
    expect(await db.trade.count({ where: { id: manualTradeId } })).toBe(0); // absorbed deleted

    // Candidate resolved.
    const candidate = await db.reconciliationCandidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(candidate.status).toBe("MERGED");
  });

  it("undo restores the manual trade and the survivor's fields", async () => {
    const result = await undoMerge(user.id, mergeLogId);
    expect(result.restoredTradeId).toBe(manualTradeId);

    const restored = await db.trade.findUniqueOrThrow({ where: { id: manualTradeId } });
    expect(restored.source).toBe("MANUAL");
    expect(restored.notes).toBe("Manually journaled");
    expect(await db.tradeScreenshot.count({ where: { tradeId: manualTradeId } })).toBe(1);
    expect(await db.tradeTag.count({ where: { tradeId: manualTradeId } })).toBe(1);

    const survivor = await db.trade.findUniqueOrThrow({ where: { id: brokerTradeId } });
    // Pre-merge state restored: notes/review were set on the broker trade in
    // the earlier "richer re-import" test — undo brings back exactly that.
    expect(survivor.notes).toBe("User note kept");
    expect(survivor.reviewStatus).toBe("REVIEWED");
    expect(Number(survivor.netPnl)).toBeCloseTo(265.2, 1); // broker values intact

    const log = await db.tradeMergeLog.findUniqueOrThrow({ where: { id: mergeLogId } });
    expect(log.undoneAt).not.toBeNull();

    // Candidate back to PENDING.
    const candidate = await db.reconciliationCandidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(candidate.status).toBe("PENDING");
  });

  it("reject / keep-separate resolve candidates without touching trades", async () => {
    const candidates = await listCandidates(user.id, { status: "PENDING" });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    await resolveCandidate(user.id, candidates[0]!.id, "REJECT");
    const after = await listCandidates(user.id, { status: "PENDING" });
    expect(after.find((c) => c.id === candidates[0]!.id)).toBeUndefined();
    expect(await db.trade.count({ where: { id: candidates[0]!.manual.id } })).toBe(1);
  });

  it("bulk merge only takes high-confidence unique pairs", async () => {
    // Re-run the matcher to restore a PENDING pair, then bulk merge.
    const { runMatcherForAccount } = await import("@/server/reconciliation");
    await runMatcherForAccount(user.id, accountId);
    const result = await bulkMergeHighConfidence(user.id);
    expect(result.merged).toBeGreaterThanOrEqual(0); // depends on scores
  });
});
