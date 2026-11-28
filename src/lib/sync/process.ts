/**
 * v3 — Ingest event-processing engine (server-side, idempotent).
 *
 * Design (v3 §4.1 "Server-side processing"):
 *  - Dedupe by (userId, eventId) through an ATOMIC SyncEventLog insert: the
 *    unique constraint is the gate; retries and out-of-order delivery never
 *    create duplicates nor regress a CLOSED trade back to OPEN.
 *  - Trades are derived from the SET of events (upsert-by-position,
 *    update-missing-fields-only), not from arrival order. Within one batch
 *    events are processed in chronological order.
 *  - MT5: a trade = a position (positionId); in/out/in-out/out-by deals map
 *    to TradeExecution rows. Netting reversals arrive as close+open pairs.
 *  - MT4: a trade = an order-ticket chain; partial closes (new ticket whose
 *    comment references the original, "from #123") are stitched into the
 *    same trade as PARTIAL_EXIT executions (server-side stitch as defense
 *    in depth — the EA does it too).
 *  - Broker P&L (account currency) overrides estimates: pnlSource = BROKER.
 *  - A connection token NEVER writes outside its bound account: the
 *    accountId comes from the connection row, never from the payload.
 *
 * Event state machine (Lot 2 — see gateEvent / settleEvent):
 *  - PROCESSING: reserved, handler running, lease held (leaseExpiresAt).
 *  - PROCESSED:  terminal success. Replays are DUPLICATE.
 *  - REJECTED:   terminal definitive failure (known business error, or
 *    retryable failures exhausted). Replays are DUPLICATE.
 *  - FAILED:     retryable failure (unexpected / infrastructure error).
 *    A later attempt may reclaim the event; attempts are bounded by
 *    SYNC_EVENT_MAX_ATTEMPTS, then the failure becomes REJECTED.
 *  Reservation is the atomic insert (unique constraint admits exactly one
 *  concurrent claimant); reclaim after a crash or a retryable failure is an
 *  atomic conditional update, so two concurrent requests can never both
 *  own the same event. The lease timestamp is the claim token: settleEvent
 *  only settles a row still PROCESSING under the lease this attempt owns.
 *
 * Pure helpers live in normalize.ts / status.ts (unit-tested separately);
 * this module owns the DB orchestration and is covered by the integration
 * tests in tests/integration/sync-engine.test.ts.
 */
import { Prisma, type Account, type BrokerConnection, type Instrument, type Trade } from "@prisma/client";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { refreshTradeSearchText } from "@/server/search-index";
import { D0, Decimal, toD } from "@/lib/trading/dec";
import {
  aggregateExecutions,
  type ExecutionLike,
} from "@/lib/trading/executions";
import { classifyResult, priceDiff, stopDistance, toPips, toPoints } from "@/lib/trading/calculate";
import { detectSessionForUser } from "@/server/tools";
import { findPreset } from "@/lib/trading/instruments";
import type { InstrumentSpec } from "@/lib/trading/types";
import { notifyUser } from "@/server/notifications";
import type { InferredSpec } from "./normalize";
import {
  balanceOperationType,
  brokerNetPnl,
  eaCostToAppCost,
  inferExitReason,
  inferSpecFromPayload,
  fallbackSpec,
  normalizeBrokerSymbol,
  parseMt4ChainComment,
  positionExternalId,
  serverTimeToUtc,
} from "./normalize";
import { evaluateLifeStatus, shouldRecordEquitySnapshot, withinSkew } from "./status";
import type {
  IngestEventResult,
  IngestResponse,
  MtEvent,
  MtHeartbeatEvent,
  MtPositionClosedEvent,
  MtPositionModifiedEvent,
  MtPositionOpenedEvent,
  MtPositionPartialCloseEvent,
  MtBalanceOperationEvent,
  MtHistoryBatchEvent,
  MtIngestPayload,
  SymbolSpecPayload,
} from "./types";

// ── Errors ───────────────────────────────────────────────────────────────────

export class IngestError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = "IngestError";
  }
}

// ── Symbol / instrument resolution ──────────────────────────────────────────

function specOfInstrument(row: Instrument): InstrumentSpec {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.assetClass,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    digits: row.digits,
    pipSize: row.pipSize,
    pointSize: row.pointSize,
    contractSize: row.contractSize,
    tickSize: row.tickSize,
    tickValue: row.tickValue,
  };
}

function assetClassHeuristic(symbol: string, digits: number): string {
  if (/^(XAU|XAG|XPT|XPD)/.test(symbol)) return "METAL";
  if (/(JPY|USD|EUR|GBP|CHF|AUD|CAD|NZD)$/.test(symbol) && /^[A-Z]{6}$/.test(symbol)) return "FOREX";
  if (digits <= 2) return "INDEX";
  return "FOREX";
}

/**
 * Resolves a broker symbol to an Instrument for the user:
 *  1. explicit SymbolMapping (userId + brokerSymbol)
 *  2. exact symbol match on the user's / global instruments
 *  3. normalized symbol match (XAUUSDm → XAUUSD)
 *  4. create from the EA-provided symbolSpec (pip heuristic, user overrides)
 *  5. fallback spec + PENDING mapping the user confirms in the UI
 * Always records a SymbolMapping so later events skip the search.
 */
export async function resolveInstrumentForSymbol(
  userId: string,
  brokerSymbol: string,
  spec?: SymbolSpecPayload | null
): Promise<Instrument> {
  const mapping = await db.symbolMapping.findUnique({
    where: { userId_brokerSymbol: { userId, brokerSymbol } },
  });
  if (mapping && mapping.instrumentId) {
    const instrument = await db.instrument.findFirst({
      where: { id: mapping.instrumentId, OR: [{ userId: null }, { userId }] },
    });
    if (instrument) return instrument;
  }

  // 2. exact then normalized match against user + global instruments.
  const candidates = await db.instrument.findMany({
    where: { OR: [{ userId: null }, { userId }], isActive: true },
    select: { id: true, symbol: true },
  });
  const upper = brokerSymbol.trim().toUpperCase();
  const exact = candidates.find((candidate) => candidate.symbol.toUpperCase() === upper);
  const target = exact
    ? exact
    : (() => {
        const normalized = normalizeBrokerSymbol(brokerSymbol);
        return candidates.find(
          (candidate) => candidate.symbol.toUpperCase() === normalized
        );
      })();

  let instrumentId: string;
  if (target) {
    instrumentId = target.id;
  } else {
    // 4/5. Create a user instrument from the spec, the preset catalogue
    // (imports carry no spec — XAUUSD still gets its 0.10 pip), or a
    // fallback. The mapping stays pending until the user reviews it.
    const normalized = normalizeBrokerSymbol(brokerSymbol);
    const preset = findPreset(normalized);
    let inferred: InferredSpec;
    if (spec) {
      inferred = inferSpecFromPayload(spec);
    } else if (preset) {
      inferred = {
        digits: preset.digits,
        pipSize: preset.pipSize,
        pointSize: preset.pointSize,
        contractSize: preset.contractSize,
        tickSize: preset.tickSize ?? null,
        tickValue: preset.tickValue ?? null,
      };
    } else {
      inferred = fallbackSpec();
    }
    const quote = normalized.length >= 6 && /^[A-Z]{6}$/.test(normalized)
      ? normalized.slice(3)
      : "USD";
    const created = await db.instrument.create({
      data: {
        userId,
        symbol: normalized,
        name: brokerSymbol,
        assetClass: preset?.assetClass ?? assetClassHeuristic(normalized, inferred.digits),
        quoteCurrency: quote,
        digits: inferred.digits,
        pipSize: inferred.pipSize,
        pointSize: inferred.pointSize,
        contractSize: inferred.contractSize,
        tickSize: inferred.tickSize,
        tickValue: inferred.tickValue,
      },
    });
    instrumentId = created.id;
  }

  await db.symbolMapping.upsert({
    where: { userId_brokerSymbol: { userId, brokerSymbol } },
    update: { instrumentId },
    create: { userId, brokerSymbol, instrumentId },
  });

  return db.instrument.findUniqueOrThrow({ where: { id: instrumentId } });
}

// ── Magic → strategy ────────────────────────────────────────────────────────

async function strategyForMagic(
  userId: string,
  connectionId: string,
  magic?: string | null
): Promise<string | null> {
  if (!magic || magic === "0" || magic === "") return null;
  const mappings = await db.magicNumberMapping.findMany({
    where: { userId, magicNumber: magic },
  });
  const scoped = mappings.find((m) => m.connectionId === connectionId) ?? mappings.find((m) => m.connectionId === null);
  if (!scoped) return null;
  const strategy = await db.strategy.findFirst({
    where: { id: scoped.strategyId, userId },
    select: { id: true },
  });
  return strategy?.id ?? null;
}

// ── Trade lookup & derived recompute ────────────────────────────────────────

async function findTradeByPosition(
  accountId: string,
  positionId: string
): Promise<Trade | null> {
  const externalFirst = await db.trade.findFirst({
    where: { accountId, positionId },
    orderBy: { createdAt: "desc" },
  });
  return externalFirst;
}

interface RecomputeInput {
  trade: Trade;
  instrument: Instrument;
  account: Account;
  /** Broker gross profit (account currency) when known - overrides estimates. */
  brokerGrossPnl?: Decimal | null;
  exitReason?: string | null;
  /** Transaction client (defaults to the global db - never deadlocks inside
   *  an interactive transaction when provided). */
  tx?: Prisma.TransactionClient;
}

/**
 * Recomputes a synced trade's aggregates from its executions with the v1
 * engine semantics: weighted-average entry/exit, costs summed, broker P&L
 * override, pips/points/R from the INITIAL stop (v3 §4.1).
 */
export async function recomputeSyncedTrade(input: RecomputeInput): Promise<void> {
  const { trade, instrument, account } = input;
  const prisma = input.tx ?? db;
  const executions = await prisma.tradeExecution.findMany({ where: { tradeId: trade.id } });
  const spec = specOfInstrument(instrument);

  const likes: ExecutionLike[] = executions.map((execution) => ({
    type: execution.type,
    time: execution.time,
    price: execution.price,
    lots: execution.lots,
    commission: execution.commission,
  }));
  const aggregate = aggregateExecutions(trade.direction as "LONG" | "SHORT", spec, likes);

  const entryPrice = aggregate.avgEntry ?? trade.entryPrice;
  const closed = aggregate.remainingLots.lte(0) && executions.some((e) => e.type === "FINAL_EXIT");
  const exitPrice = closed ? aggregate.avgExit ?? trade.exitPrice : null;

  // Costs: per-execution commission sums (already in app signing).
  const totalCommission = executions.reduce((sum, e) => sum.plus(toD(e.commission)), D0);

  // Broker truth: gross profit in ACCOUNT currency from closing deals.
  const brokerGross =
    input.brokerGrossPnl ??
    (executions.some((e) => e.type === "FINAL_EXIT" || e.type === "PARTIAL_EXIT")
      ? executions.reduce(
          (sum, e) => (e.pnl !== null ? sum.plus(toD(e.pnl)) : sum),
          D0
        )
      : null);

  // netPnl = broker gross − (commission + swap + fees); swap/fees live on the
  // trade row (accumulated by the close handlers).
  const netPnl =
    brokerGross !== null
      ? brokerGross.minus(totalCommission).minus(toD(trade.swap)).minus(toD(trade.fees))
      : null;

  // Pips / points from weighted-average prices.
  const diff = exitPrice !== null ? priceDiff(trade.direction as "LONG" | "SHORT", entryPrice, exitPrice) : null;

  // R from the INITIAL stop (v3 §4.1: "R using the INITIAL stop loss").
  const stopDist = stopDistance(
    trade.direction as "LONG" | "SHORT",
    entryPrice,
    trade.initialStopLoss ?? trade.stopLoss
  );
  const riskAmount =
    stopDist && stopDist.gt(0)
      ? stopDist.times(aggregate.totalEntryLots).times(toD(instrument.contractSize))
      : null;
  const rMultiple = netPnl !== null && riskAmount && riskAmount.gt(0) ? netPnl.div(riskAmount) : null;

  const resultType = closed && netPnl !== null ? classifyResult(netPnl, rMultiple) : null;

  const update: Prisma.TradeUpdateInput = {
    entryPrice,
    exitPrice,
    lots: aggregate.totalEntryLots,
    units: aggregate.totalEntryLots.times(toD(instrument.contractSize)),
    commission: totalCommission,
    ...(diff !== null ? { pips: toPips(spec, diff), points: toPoints(spec, diff) } : {}),
    ...(brokerGross !== null ? { grossPnl: brokerGross } : {}),
    ...(netPnl !== null
      ? {
          netPnl,
          rMultiple,
          realizedRR: rMultiple,
          resultType: resultType as string | null,
          pnlSource: "BROKER",
          pnlCurrency: account.currency,
        }
      : {}),
    ...(riskAmount && riskAmount.gt(0) ? { riskAmount } : {}),
    ...(input.exitReason ? { exitReason: input.exitReason } : {}),
    updatedAt: new Date(),
  };

  await prisma.trade.update({ where: { id: trade.id }, data: update });
}

// ── Event handlers ───────────────────────────────────────────────────────────

interface HandlerContext {
  connection: BrokerConnection;
  account: Account;
  payload: MtIngestPayload;
  utc: (seconds: number) => Date;
}

async function handleHeartbeat(ctx: HandlerContext, event: MtHeartbeatEvent): Promise<void> {
  const { connection, account } = ctx;
  const now = ctx.utc(event.time);

  await db.brokerConnection.update({
    where: { id: connection.id },
    data: {
      lastHeartbeatAt: now,
      lastEventAt: now,
      eaVersion: ctx.payload.eaVersion,
      ...(connection.status === "STALE" || connection.status === "PENDING"
        ? { status: "ACTIVE" }
        : {}),
      ...(ctx.payload.leverage ? { account: { update: { leverage: Math.round(toD(ctx.payload.leverage).toNumber()) } } } : {}),
    },
  });

  if (shouldRecordEquitySnapshot(null, now)) {
    const latest = await db.accountEquitySnapshot.findFirst({
      where: { accountId: account.id },
      orderBy: { time: "desc" },
      select: { time: true },
    });
    if (shouldRecordEquitySnapshot(latest?.time ?? null, now)) {
      await db.accountEquitySnapshot.create({
        data: {
          userId: connection.userId,
          accountId: account.id,
          time: now,
          balance: event.balance,
          equity: event.equity,
          margin: event.margin ?? null,
        },
      });
    }
  }
}

async function handlePositionOpened(
  ctx: HandlerContext,
  event: MtPositionOpenedEvent
): Promise<void> {
  const { connection, account, payload } = ctx;
  const externalId = positionExternalId(payload.platform, payload.server, payload.login, event.positionId);

  // MT4 partial-close stitch: a remainder ticket referencing the original
  // ("from #123") becomes an ADD execution on the chain head, not a new trade.
  if (payload.platform === "MT4") {
    const chain = parseMt4ChainComment(event.comment);
    if (chain && chain.kind === "from") {
      const parent = await findTradeByPosition(account.id, chain.ticket);
      if (parent && parent.status === "OPEN") {
        await db.tradeExecution.create({
          data: {
            tradeId: parent.id,
            type: "ADD",
            time: ctx.utc(event.openTime),
            price: event.openPrice,
            lots: event.volume,
            commission: D0,
          },
        });
        await recomputeSyncedTrade({ trade: parent, instrument: await instrumentOf(parent), account });
        return;
      }
    }
  }

  // v2.5 M4 — the dedupe key (accountId, externalId) survives soft delete:
  // the EA lookup runs INCLUDING trashed rows; a trashed OPEN position that
  // the broker re-announces is RESTORED (a duplicate would violate the
  // unique constraint). Trashed CLOSED tickets stay trashed on replays.
  const existing = await withDeleted(() =>
    db.trade.findUnique({ where: { accountId_externalId: { accountId: account.id, externalId } } })
  );
  if (existing) {
    if (existing.status === "OPEN") {
      // Idempotent re-send: fill missing fields only, never regress.
      // A trashed open position is restored by the same write.
      await db.trade.update({
        where: { id: existing.id },
        data: {
          ...(existing.deletedAt != null ? { deletedAt: null, deletedBy: null } : {}),
          ...(existing.stopLoss === null && event.stopLoss ? { stopLoss: event.stopLoss, initialStopLoss: event.stopLoss } : {}),
          ...(existing.takeProfit === null && event.takeProfit ? { takeProfit: event.takeProfit } : {}),
          ...(existing.magicNumber === null && event.magic ? { magicNumber: event.magic } : {}),
        },
      });
    }
    return; // CLOSED trades are never reopened by an out-of-order OPENED.
  }

  const instrument = await resolveInstrumentForSymbol(connection.userId, event.symbol, event.symbolSpec);
  const strategyId = await strategyForMagic(connection.userId, connection.id, event.magic);
  const entryTime = ctx.utc(event.openTime);

  const trade = await db.trade.create({
    data: {
      userId: connection.userId,
      accountId: account.id,
      instrumentId: instrument.id,
      strategyId,
      externalId,
      positionId: event.positionId,
      direction: event.direction,
      orderType: "MARKET",
      status: "OPEN",
      entryTime,
      entryPrice: event.openPrice,
      stopLoss: event.stopLoss ?? null,
      takeProfit: event.takeProfit ?? null,
      initialStopLoss: event.stopLoss ?? null,
      initialTakeProfit: event.takeProfit ?? null,
      lots: event.volume,
      units: toD(event.volume).times(toD(instrument.contractSize)),
      magicNumber: event.magic ?? null,
      brokerComment: event.comment ?? null,
      source: "EA_SYNC",
      needsDetails: true,
      session: await detectSessionForUser(connection.userId, entryTime),
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
      pnlSource: "CALCULATED",
      pnlCurrency: account.currency,
    },
  });

  await db.tradeExecution.create({
    data: {
      tradeId: trade.id,
      type: "ENTRY",
      time: entryTime,
      price: event.openPrice,
      lots: event.volume,
      commission: D0,
    },
  });
  // v2.5 M4 — normalized search column (§4.2).
  await refreshTradeSearchText(trade.id);

  await db.brokerConnection.update({
    where: { id: connection.id },
    data: { lastEventAt: ctx.utc(event.time) },
  });
}

async function instrumentOf(trade: Trade): Promise<Instrument> {
  return db.instrument.findUniqueOrThrow({ where: { id: trade.instrumentId } });
}

async function handlePositionModified(
  ctx: HandlerContext,
  event: MtPositionModifiedEvent
): Promise<void> {
  const { account } = ctx;
  const trade = await findTradeByPosition(account.id, event.positionId);
  if (!trade || trade.status !== "OPEN") return;

  const now = ctx.utc(event.time);
  const changes: Prisma.TradeUpdateInput = { updatedAt: now };

  if (event.stopLoss !== undefined && event.stopLoss !== null) {
    const old = trade.stopLoss ? trade.stopLoss.toString() : null;
    const changed = old === null || new Decimal(event.stopLoss).minus(old).abs().gt(0);
    if (changed) {
      await db.tradeModification.create({
        data: {
          tradeId: trade.id,
          userId: trade.userId,
          time: now,
          field: "STOP_LOSS",
          oldValue: old,
          newValue: event.stopLoss,
          source: "EA_SYNC",
        },
      });
      changes.stopLoss = event.stopLoss;
      // First SL seen becomes initialStopLoss (v3 §4.1) unless user set one.
      if (trade.initialStopLoss === null) changes.initialStopLoss = event.stopLoss;
    }
  }

  if (event.takeProfit !== undefined && event.takeProfit !== null) {
    const old = trade.takeProfit ? trade.takeProfit.toString() : null;
    const changed = old === null || new Decimal(event.takeProfit).minus(old).abs().gt(0);
    if (changed) {
      await db.tradeModification.create({
        data: {
          tradeId: trade.id,
          userId: trade.userId,
          time: now,
          field: "TAKE_PROFIT",
          oldValue: old,
          newValue: event.takeProfit,
          source: "EA_SYNC",
        },
      });
      changes.takeProfit = event.takeProfit;
      if (trade.initialTakeProfit === null) changes.initialTakeProfit = event.takeProfit;
    }
  }

  if (event.volume !== undefined && event.volume !== null) {
    const currentLots = toD(trade.lots);
    const newVolume = toD(event.volume);
    if (newVolume.gt(currentLots)) {
      // Netting scale-in: ADD execution for the delta.
      await db.tradeExecution.create({
        data: {
          tradeId: trade.id,
          type: "ADD",
          time: now,
          price: trade.entryPrice,
          lots: newVolume.minus(currentLots),
          commission: D0,
        },
      });
      await db.tradeModification.create({
        data: {
          tradeId: trade.id,
          userId: trade.userId,
          time: now,
          field: "VOLUME",
          oldValue: currentLots.toString(),
          newValue: event.volume,
          source: "EA_SYNC",
        },
      });
    }
  }

  await db.trade.update({ where: { id: trade.id }, data: changes });
  await recomputeSyncedTrade({
    trade: { ...trade, ...(changes as object) } as Trade,
    instrument: await instrumentOf(trade),
    account,
  });
}

async function handlePositionPartialClose(
  ctx: HandlerContext,
  event: MtPositionPartialCloseEvent
): Promise<void> {
  const { account } = ctx;
  const trade = await findTradeByPosition(account.id, event.positionId);
  if (!trade) return;
  if (trade.status === "CLOSED") return; // never regress

  // Idempotency within executions: same (type, time, price, lots) already there?
  const closeTime = ctx.utc(event.closeTime);
  const duplicate = await db.tradeExecution.findFirst({
    where: { tradeId: trade.id, type: "PARTIAL_EXIT", time: closeTime, lots: event.closedVolume },
  });
  if (duplicate) return;

  const commission = eaCostToAppCost(event.commission);
  const swapCost = eaCostToAppCost(event.swap);

  await db.tradeExecution.create({
    data: {
      tradeId: trade.id,
      type: "PARTIAL_EXIT",
      time: closeTime,
      price: event.closePrice,
      lots: event.closedVolume,
      commission,
      pnl: event.profit,
    },
  });

  if (!swapCost.isZero()) {
    await db.trade.update({
      where: { id: trade.id },
      data: { swap: toD(trade.swap).plus(swapCost) },
    });
  }

  const fresh = await db.trade.findUniqueOrThrow({ where: { id: trade.id } });
  await recomputeSyncedTrade({ trade: fresh, instrument: await instrumentOf(fresh), account });
}

async function applyPositionClosed(
  ctx: HandlerContext,
  params: {
    positionId: string;
    ticket: string;
    symbol?: string | null;
    symbolSpec?: SymbolSpecPayload | null;
    direction?: "LONG" | "SHORT" | null;
    volume: string;
    openTime?: number | null;
    openPrice?: string | null;
    closeTime: number;
    closePrice: string;
    stopLoss?: string | null;
    takeProfit?: string | null;
    commission?: string | null;
    swap?: string | null;
    fees?: string | null;
    profit: string;
    magic?: string | null;
    comment?: string | null;
    mfePrice?: string | null;
    maePrice?: string | null;
    mfeMaeComplete?: boolean | null;
  }
): Promise<void> {
  const { connection, account, payload } = ctx;
  const p = params;
  const externalId = positionExternalId(payload.platform, payload.server, payload.login, p.positionId);
  const closeTimeUtc = ctx.utc(p.closeTime);

  const existing = await withDeleted(() =>
    db.trade.findUnique({
      where: { accountId_externalId: { accountId: account.id, externalId } },
    })
  );

  const brokerGross = toD(p.profit);
  const costs = {
    commission: eaCostToAppCost(p.commission),
    swap: eaCostToAppCost(p.swap),
    fees: eaCostToAppCost(p.fees),
  };

  if (existing && existing.status === "CLOSED") {
    return; // idempotent across live event + history backfill
  }

  let trade: Trade;
  if (existing) {
    // Final close of a tracked open position.
    const duplicate = await db.tradeExecution.findFirst({
      where: { tradeId: existing.id, type: "FINAL_EXIT", time: closeTimeUtc },
    });
    if (!duplicate) {
      await db.tradeExecution.create({
        data: {
          tradeId: existing.id,
          type: "FINAL_EXIT",
          time: closeTimeUtc,
          price: p.closePrice,
          lots: p.volume,
          commission: costs.commission,
          pnl: p.profit,
        },
      });
    }

    const update: Prisma.TradeUpdateInput = {
      status: "CLOSED",
      exitTime: closeTimeUtc,
      exitPrice: p.closePrice,
      swap: toD(existing.swap).plus(costs.swap),
      fees: toD(existing.fees).plus(costs.fees),
      ...(p.mfePrice ? { mfePrice: p.mfePrice } : {}),
      ...(p.maePrice ? { maePrice: p.maePrice } : {}),
      ...(p.mfePrice || p.maePrice ? { mfeMaeSource: "EA_TRACKED" } : {}),
      ...(p.mfeMaeComplete !== undefined && p.mfeMaeComplete !== null
        ? { mfeMaeComplete: p.mfeMaeComplete }
        : {}),
      ...(existing.stopLoss === null && p.stopLoss ? { stopLoss: p.stopLoss, initialStopLoss: p.stopLoss } : {}),
      ...(existing.takeProfit === null && p.takeProfit ? { takeProfit: p.takeProfit } : {}),
      // v2.5 M4 — the real close of a trashed OPEN position restores the
      // row (new information; replays of CLOSED tickets returned above).
      ...(existing.deletedAt != null ? { deletedAt: null, deletedBy: null } : {}),
      updatedAt: new Date(),
    };
    await db.trade.update({ where: { id: existing.id }, data: update });
    trade = await db.trade.findUniqueOrThrow({ where: { id: existing.id } });
    // NOTE: no brokerGrossPnl override here — the closing deal's profit is
    // PER-DEAL; the position's true gross is the SUM of exit executions
    // (partial closes already recorded their own pnl).
    await recomputeSyncedTrade({
      trade,
      instrument: await instrumentOf(trade),
      account,
      exitReason: inferExitReason(
        trade.direction as "LONG" | "SHORT",
        p.closePrice,
        trade.stopLoss?.toString() ?? p.stopLoss ?? null,
        trade.takeProfit?.toString() ?? p.takeProfit ?? null
      ),
    });
  } else {
    // Backfill / out-of-order: create the full closed trade at once.
    const symbol = p.symbol ?? p.positionId;
    const instrument = await resolveInstrumentForSymbol(connection.userId, symbol, p.symbolSpec);
    const strategyId = await strategyForMagic(connection.userId, connection.id, p.magic);
    const entryTime = ctx.utc(p.openTime ?? p.closeTime);
    const direction = p.direction ?? "LONG";

    const created = await db.trade.create({
      data: {
        userId: connection.userId,
        accountId: account.id,
        instrumentId: instrument.id,
        strategyId,
        externalId,
        positionId: p.positionId,
        direction,
        orderType: "MARKET",
        status: "CLOSED",
        entryTime,
        entryPrice: p.openPrice ?? p.closePrice,
        exitTime: closeTimeUtc,
        exitPrice: p.closePrice,
        stopLoss: p.stopLoss ?? null,
        takeProfit: p.takeProfit ?? null,
        initialStopLoss: p.stopLoss ?? null,
        initialTakeProfit: p.takeProfit ?? null,
        lots: p.volume,
        mfePrice: p.mfePrice ?? null,
        maePrice: p.maePrice ?? null,
        mfeMaeSource: p.mfePrice || p.maePrice ? "EA_TRACKED" : "NONE",
        mfeMaeComplete: p.mfeMaeComplete ?? false,
        commission: costs.commission,
        swap: costs.swap,
        fees: costs.fees,
        grossPnl: brokerGross,
        netPnl: brokerNetPnl(p.profit, p.commission, p.swap, p.fees),
        pnlSource: "BROKER",
        pnlCurrency: account.currency,
        exitReason: inferExitReason(direction, p.closePrice, p.stopLoss, p.takeProfit),
        magicNumber: p.magic ?? null,
        brokerComment: p.comment ?? null,
        source: "EA_SYNC",
        needsDetails: true,
        session: await detectSessionForUser(connection.userId, entryTime),
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
          time: entryTime,
          price: p.openPrice ?? p.closePrice,
          lots: p.volume,
          commission: D0,
        },
        {
          tradeId: created.id,
          type: "FINAL_EXIT",
          time: closeTimeUtc,
          price: p.closePrice,
          lots: p.volume,
          commission: costs.commission,
          pnl: p.profit,
        },
      ],
    });
    trade = created;
    // v2.5 M4 — normalized search column (§4.2).
    await refreshTradeSearchText(created.id);

    // Recompute pips/R/risk from the engine (P&L stays broker-sourced).
    await recomputeSyncedTrade({
      trade,
      instrument,
      account,
      exitReason: inferExitReason(direction, p.closePrice, p.stopLoss, p.takeProfit),
    });
  }

  await db.brokerConnection.update({
    where: { id: connection.id },
    data: { lastEventAt: closeTimeUtc },
  });
}

async function handleBalanceOperation(
  ctx: HandlerContext,
  event: MtBalanceOperationEvent
): Promise<void> {
  const { connection, account } = ctx;
  // Dedupe via the (accountId, externalId) unique constraint on CashTransaction.
  const existing = await db.cashTransaction.findUnique({
    where: { accountId_externalId: { accountId: account.id, externalId: event.eventId } },
  });
  if (existing) return;

  await db.cashTransaction.create({
    data: {
      userId: connection.userId,
      accountId: account.id,
      type: balanceOperationType(event.amount, event.kind),
      amount: event.amount,
      date: ctx.utc(event.time),
      note: event.comment ?? "MetaTrader",
      externalId: event.eventId,
    },
  });
}

async function handleHistoryBatch(
  ctx: HandlerContext,
  event: MtHistoryBatchEvent
): Promise<void> {
  for (const historyTrade of event.trades) {
    await applyPositionClosed(ctx, { ...historyTrade });
  }
}

// ── Event gating (atomic idempotency) ───────────────────────────────────────

/**
 * Sync-event state machine (Lot 2).
 *
 * States (SyncEventLog.status):
 *  - PROCESSING: reserved, handler running, lease held (leaseExpiresAt).
 *  - PROCESSED:  terminal success. Replays are DUPLICATE.
 *  - REJECTED:   terminal definitive failure (known business error, or
 *    retryable failures exhausted). Replays are DUPLICATE.
 *  - FAILED:     retryable failure (unexpected / infrastructure error).
 *    A later attempt may reclaim the event; attempts are bounded.
 *
 * Transitions:
 *  - (none) --atomic insert--> PROCESSING (unique (userId, eventId) is the gate)
 *  - PROCESSING --handler ok--> PROCESSED
 *  - PROCESSING --IngestError (definitive)--> REJECTED
 *  - PROCESSING --unexpected error--> FAILED (lease released)
 *  - PROCESSING --lease expired (crash)--> reclaimable --> PROCESSING
 *  - FAILED --reclaim, attempts < MAX--> PROCESSING
 *  - FAILED / PROCESSING --attempts exhausted--> REJECTED (RETRY_EXHAUSTED)
 *  - PROCESSED / REJECTED --replay--> DUPLICATE (no state change)
 *
 * Ownership: the lease timestamp (leaseExpiresAt) is the claim token.
 * settleEvent() only settles a row still PROCESSING under the lease this
 * attempt owns, so a slow owner can never overwrite a reclaimer's outcome.
 */

/** Lease for a PROCESSING reservation. A single event (incl. a 100-trade
 *  HISTORY_BATCH) finishes in seconds; 5 minutes bounds crash recovery
 *  while leaving ample margin. */
export const SYNC_EVENT_LEASE_MS = 5 * 60 * 1000;

/** Bounded retries for retryable (FAILED) events; then the failure is
 *  definitive (REJECTED / RETRY_EXHAUSTED). */
export const SYNC_EVENT_MAX_ATTEMPTS = 5;

export type SyncEventOutcome = "NEW" | "DUPLICATE";

interface GateClaim {
  outcome: SyncEventOutcome;
  /** Lease this attempt owns (null when DUPLICATE — nothing to settle). */
  leaseExpiresAt: Date | null;
  /** Attempts claimed so far for this event (including this one). */
  attempts: number;
}

/**
 * Classifies a handler failure:
 *  - IngestError (known, coded business error) -> definitive REJECTED.
 *  - Anything else (unexpected / infrastructure) -> retryable FAILED.
 * The response to the EA stays REJECTED in both cases (contract unchanged);
 * the distinction lives in the stored state, which controls server-side retry.
 */
export function classifyIngestFailure(error: unknown): {
  terminal: "REJECTED" | "FAILED";
  code: string;
} {
  if (error instanceof IngestError) {
    return { terminal: "REJECTED", code: error.code };
  }
  return { terminal: "FAILED", code: "EVENT_FAILED" };
}

async function gateEvent(
  userId: string,
  connectionId: string,
  event: MtEvent
): Promise<GateClaim> {
  const lease = new Date(Date.now() + SYNC_EVENT_LEASE_MS);
  // Reservation is the atomic insert: the unique (userId, eventId)
  // constraint admits exactly one concurrent claimant.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.syncEventLog.create({
        data: {
          userId,
          connectionId,
          eventId: event.eventId,
          type: event.type,
          status: "PROCESSING",
          leaseExpiresAt: lease,
          attempts: 1,
        },
      });
      return { outcome: "NEW", leaseExpiresAt: lease, attempts: 1 };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const claim = await claimExistingEvent(userId, event.eventId, lease);
        if (claim) return claim;
        // Row vanished between the conflict and the read (cascade delete);
        // retry the reservation once.
        continue;
      }
      throw error;
    }
  }
  // Extremely defensive: if the row keeps vanishing, report a duplicate
  // rather than risk processing the same event twice.
  return { outcome: "DUPLICATE", leaseExpiresAt: null, attempts: 0 };
}

/**
 * Decides what a conflicting (already-reserved) event means. Returns null
 * only when the row vanished between the unique violation and the read.
 */
async function claimExistingEvent(
  userId: string,
  eventId: string,
  lease: Date
): Promise<GateClaim | null> {
  const now = new Date();
  const prior = await db.syncEventLog.findUnique({
    where: { userId_eventId: { userId, eventId } },
  });
  if (!prior) return null;

  // Terminal states: replays are duplicates, no state change.
  if (prior.status === "PROCESSED" || prior.status === "REJECTED") {
    return { outcome: "DUPLICATE", leaseExpiresAt: null, attempts: prior.attempts };
  }

  // Still in progress under a live lease: never reprocess.
  if (
    prior.status === "PROCESSING" &&
    prior.leaseExpiresAt &&
    prior.leaseExpiresAt.getTime() > now.getTime()
  ) {
    return { outcome: "DUPLICATE", leaseExpiresAt: null, attempts: prior.attempts };
  }

  // From here: FAILED, or PROCESSING with an expired (or missing) lease —
  // i.e. abandoned after a crash. No longer owned by anyone.
  if (prior.attempts >= SYNC_EVENT_MAX_ATTEMPTS) {
    // Retry budget spent: the failure becomes definitive. Atomic: only
    // escalate if the row is still in the state we read.
    await db.syncEventLog.updateMany({
      where: { id: prior.id, status: prior.status, attempts: prior.attempts },
      data: {
        status: "REJECTED",
        errorCode: "RETRY_EXHAUSTED",
        leaseExpiresAt: null,
        processedAt: now,
      },
    });
    return { outcome: "DUPLICATE", leaseExpiresAt: null, attempts: prior.attempts };
  }

  // Atomic reclaim: exactly one concurrent claimant flips the row (the
  // attempts predicate guards against a racing claim).
  const claimed = await db.syncEventLog.updateMany({
    where: {
      id: prior.id,
      status: prior.status,
      attempts: prior.attempts,
      ...(prior.status === "PROCESSING"
        ? { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }
        : {}),
    },
    data: {
      status: "PROCESSING",
      leaseExpiresAt: lease,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 1) {
    return { outcome: "NEW", leaseExpiresAt: lease, attempts: prior.attempts + 1 };
  }
  return { outcome: "DUPLICATE", leaseExpiresAt: null, attempts: prior.attempts };
}

async function settleEvent(
  userId: string,
  eventId: string,
  leaseExpiresAt: Date | null,
  status: "PROCESSED" | "REJECTED" | "FAILED",
  errorCode?: string
): Promise<void> {
  const data = {
    status,
    errorCode: errorCode ?? null,
    processedAt: new Date(),
    // Terminal or retryable: no lease is held anymore.
    leaseExpiresAt: null,
  };
  if (leaseExpiresAt) {
    // Only the lease owner settles: if the lease expired and another
    // attempt reclaimed the event, this update matches nothing and the
    // reclaimer's outcome is preserved.
    await db.syncEventLog.updateMany({
      where: {
        userId,
        eventId,
        status: "PROCESSING",
        leaseExpiresAt,
      },
      data,
    });
  } else {
    await db.syncEventLog.update({
      where: { userId_eventId: { userId, eventId } },
      data,
    });
  }
}

// ── Payload orchestrator ─────────────────────────────────────────────────────

/**
 * Processes a validated ingest payload for a connection. Returns per-event
 * results (ACCEPTED | DUPLICATE | REJECTED + reason). Never throws for
 * per-event issues — only for infrastructure failures.
 */
export async function processIngestPayload(
  connection: BrokerConnection,
  payload: MtIngestPayload
): Promise<IngestResponse> {
  if (connection.status === "REVOKED") {
    throw new IngestError("CONNECTION_REVOKED", 403);
  }
  // MISMATCH is a sticky safety state. Only an explicit owner-initiated
  // reset/rotation may clear the binding and allow another terminal to bind.
  if (connection.status === "MISMATCH") {
    throw new IngestError("CONNECTION_MISMATCH", 403);
  }

  // Replay protection: reject payloads with excessive clock skew.
  if (!withinSkew(payload.sentAt)) {
    throw new IngestError("CLOCK_SKEW", 400);
  }

  // Binding: first payload binds (server, login); mismatch => MISMATCH.
  // Use a conditional write against the state we actually read. A concurrent
  // owner revocation must win over a stale first-handshake request: an
  // unconditional UPDATE here could otherwise change REVOKED back to ACTIVE.
  const wasUnbound =
    connection.brokerServer === null || connection.brokerLogin === null;
  if (wasUnbound) {
    await db.brokerConnection.updateMany({
      where: {
        id: connection.id,
        status: connection.status,
        brokerServer: null,
        brokerLogin: null,
      },
      data: {
        brokerServer: payload.server,
        brokerLogin: payload.login,
        ...(connection.status === "PENDING" ? { status: "ACTIVE" } : {}),
      },
    });
    // Always re-read after the compare-and-set. If the claim lost to a
    // revocation (or another state transition), never continue with the
    // stale connection snapshot.
    connection = await db.brokerConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    if (connection.status === "REVOKED") {
      throw new IngestError("CONNECTION_REVOKED", 403);
    }
    if (connection.status === "MISMATCH") {
      throw new IngestError("CONNECTION_MISMATCH", 403);
    }
    // Also mirror the winning binding onto the account for import matching.
    if (
      connection.brokerServer === payload.server &&
      connection.brokerLogin === payload.login
    ) {
      await db.account.update({
        where: { id: connection.accountId },
        data: { brokerServer: payload.server, brokerLogin: payload.login },
      });
    }
  }

  if (
    connection.brokerServer !== payload.server ||
    connection.brokerLogin !== payload.login
  ) {
    await db.brokerConnection.updateMany({
      where: { id: connection.id, status: { not: "REVOKED" } },
      data: { status: "MISMATCH" },
    });
    await notifyUser({
      userId: connection.userId,
      type: "SYNC_MISMATCH",
      title: "MT connection conflict",
      body: `The terminal “${connection.label}” is sending data from another account (${payload.server} / ${payload.login}). Events are rejected – check the token.`,
      url: "/broker-sync",
      dedupeKey: connection.id,
      dedupeWithinMs: 24 * 60 * 60 * 1000,
    });
    throw new IngestError("LOGIN_MISMATCH", 403);
  }

  const account = await db.account.findUniqueOrThrow({ where: { id: connection.accountId } });
  const ctx: HandlerContext = {
    connection,
    account,
    payload,
    utc: (seconds) => serverTimeToUtc(seconds, payload.serverGmtOffsetSeconds),
  };

  // Chronological order within the batch — out-of-order ACROSS batches is
  // tolerated by the upsert handlers themselves.
  const ordered = [...payload.events].sort((a, b) => a.time - b.time);
  const results: IngestEventResult[] = [];

  for (const event of ordered) {
    const gate = await gateEvent(connection.userId, connection.id, event);
    if (gate.outcome === "DUPLICATE") {
      results.push({ eventId: event.eventId, status: "DUPLICATE" });
      continue;
    }

    try {
      switch (event.type) {
        case "HEARTBEAT":
          await handleHeartbeat(ctx, event);
          break;
        case "POSITION_OPENED":
          await handlePositionOpened(ctx, event);
          break;
        case "POSITION_MODIFIED":
          await handlePositionModified(ctx, event);
          break;
        case "POSITION_PARTIAL_CLOSE":
          await handlePositionPartialClose(ctx, event);
          break;
        case "POSITION_CLOSED":
          await applyPositionClosed(ctx, event);
          break;
        case "BALANCE_OPERATION":
          await handleBalanceOperation(ctx, event);
          break;
        case "HISTORY_BATCH":
          await handleHistoryBatch(ctx, event);
          break;
        case "ORDER_PLACED":
        case "ORDER_CANCELLED":
          // Pending orders: acknowledged, not persisted (v1 has no order model).
          break;
      }
      await settleEvent(connection.userId, event.eventId, gate.leaseExpiresAt, "PROCESSED");
      results.push({ eventId: event.eventId, status: "ACCEPTED" });
    } catch (error) {
      const { terminal, code } = classifyIngestFailure(error);
      const exhausted = gate.attempts >= SYNC_EVENT_MAX_ATTEMPTS;
      const rejected = terminal === "REJECTED" || exhausted;
      const settleCode =
        rejected && terminal !== "REJECTED" ? "RETRY_EXHAUSTED" : code;
      await settleEvent(
        connection.userId,
        event.eventId,
        gate.leaseExpiresAt,
        rejected ? "REJECTED" : "FAILED",
        settleCode
      );
      results.push({ eventId: event.eventId, status: "REJECTED", reason: settleCode });
      console.error(`[sync] event ${event.eventId} failed:`, error);
    }
  }

  return { results };
}

// ── STALE sweep (app open + daily cron) ──────────────────────────────────────

export interface StaleSweepResult {
  checked: number;
  staleCount: number;
}

/** Re-evaluates ACTIVE/STALE statuses for all live connections of all users. */
export async function sweepStaleConnections(now: Date = new Date()): Promise<StaleSweepResult> {
  const connections = await db.brokerConnection.findMany({
    where: { status: { in: ["ACTIVE", "STALE", "PENDING"] } },
  });

  let staleCount = 0;
  for (const connection of connections) {
    const life = evaluateLifeStatus(connection.lastHeartbeatAt, now);
    if (life !== connection.status && life !== "PENDING") {
      await db.brokerConnection.update({
        where: { id: connection.id },
        data: { status: life },
      });
      if (life === "STALE") {
        staleCount += 1;
        await notifyUser({
          userId: connection.userId,
          type: "SYNC_STALE",
          title: "Synchronisation interrompue",
          body: `No heartbeat from “${connection.label}” for over 30 minutes – is MetaTrader open?`,
          url: "/broker-sync",
          dedupeKey: connection.id,
          dedupeWithinMs: 6 * 60 * 60 * 1000,
        });
      }
    } else if (connection.status === "STALE") {
      staleCount += 1;
    }
  }

  return { checked: connections.length, staleCount };
}
