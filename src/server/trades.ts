/**
 * Trades — server-side data access (userId-scoped, v2 Phase 1).
 *
 * Every function takes the SESSION userId and scopes all reads/writes with it
 * (isolation pattern proven by tests/integration/isolation.test.ts).
 * Derived values (pips, P&L, R, session, risk %) are ALWAYS recomputed
 * server-side by the pure engine — the client never sends computed results.
 */
import type { Prisma, Trade, Account, Instrument } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal, toD } from "@/lib/trading/dec";
import {
  previewTrade,
  classifyResult,
  type TradePreview,
} from "@/lib/trading/calculate";
import { detectSessionSafe } from "@/lib/trading/session";
import type { InstrumentSpec } from "@/lib/trading/types";
import type {
  CloseTradeInput,
  TradeInput,
  TradeListQuery,
  TradePatch,
} from "@/lib/validations/trade";
import type {
  PaginatedDTO,
  TagDTO,
  TradeDetailDTO,
  TradeListItemDTO,
} from "@/lib/trading/dto";
import { evaluateTradeViolations } from "@/server/rules";
import { refreshTradeSearchText } from "@/server/search-index";

/** Validation/ownership errors — mapped to typed API responses by the routes. */
export class TradeValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "TradeValidationError";
    this.code = code;
    this.status = status;
  }
}

// ── Row → DTO mappers ────────────────────────────────────────────────────────

type TradeRow = Prisma.TradeGetPayload<{
  include: {
    instrument: true;
    account: true;
    strategy: true;
    tags: { include: { tag: true } };
  };
}>;

type TradeFullRow = Prisma.TradeGetPayload<{
  include: {
    instrument: true;
    account: true;
    strategy: true;
    tags: { include: { tag: true } };
    screenshots: true;
    executions: { orderBy: { time: "asc" } };
    review: { select: { id: true } };
    // v2.5 M2 — price chart overlay sources
    modifications: { orderBy: { time: "asc" } };
    eventLinks: { include: { event: true } };
  };
}>;

/**
 * Lighter row shape accepted by toTradeDetail — modifications / eventLinks
 * are OPTIONAL (mentor views omit them; the mapper defaults both to []) and
 * only the review id is needed (hasReview flag).
 */
type TradeDetailRow = Omit<
  TradeFullRow,
  "modifications" | "eventLinks" | "review"
> & {
  modifications?: TradeFullRow["modifications"];
  eventLinks?: TradeFullRow["eventLinks"];
  review: { id: string } | null;
};

/** Shared include for every TradeDetailDTO mapper call site. */
const DETAIL_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
  screenshots: { orderBy: { createdAt: "asc" } },
  executions: { orderBy: { time: "asc" } },
  review: { select: { id: true } },
  // v2.5 M2 — price chart overlay sources
  modifications: { orderBy: { time: "asc" } },
  eventLinks: { include: { event: true } },
} as const;

const s = (v: Decimal | string | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toString();

export function toInstrumentSpec(row: Instrument): InstrumentSpec {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.assetClass,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    digits: row.digits,
    pipSize: row.pipSize.toString(),
    pointSize: row.pointSize.toString(),
    contractSize: row.contractSize.toString(),
    tickSize: row.tickSize?.toString() ?? null,
    tickValue: row.tickValue?.toString() ?? null,
  };
}

function baseItem(t: TradeRow): TradeListItemDTO {
  // v2.5 M4 — references to soft-deleted entities are hidden in DTOs: a
  // trashed strategy shows as "none" on the trade until it is restored
  // (the trade itself keeps its strategyId — restore brings it back).
  const liveStrategy = t.strategy?.deletedAt == null ? t.strategy : null;
  return {
    id: t.id,
    accountId: t.accountId,
    accountName: t.account.name,
    strategyId: liveStrategy ? t.strategyId : null,
    strategyName: liveStrategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    digits: t.instrument.digits,
    direction: t.direction,
    orderType: t.orderType,
    status: t.status,
    timeframe: t.timeframe,
    session: t.session,
    setupType: t.setupType,
    entryTime: t.entryTime.toISOString(),
    exitTime: t.exitTime?.toISOString() ?? null,
    entryPrice: t.entryPrice.toString(),
    exitPrice: s(t.exitPrice),
    stopLoss: s(t.stopLoss),
    takeProfit: s(t.takeProfit),
    lots: t.lots.toString(),
    riskPercent: s(t.riskPercent),
    pips: s(t.pips),
    netPnl: s(t.netPnl),
    pnlCurrency: t.pnlCurrency,
    rMultiple: s(t.rMultiple),
    plannedRR: s(t.plannedRR),
    resultType: t.resultType,
    exitReason: t.exitReason,
    reviewStatus: t.reviewStatus,
    isDraft: t.isDraft,
    emotionBefore: t.emotionBefore,
    followedPlan: t.followedPlan,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    tags: t.tags
      .filter((tt) => tt.tag.deletedAt == null)
      .map((tt) => tt.tag)
      .map((tag): TagDTO => ({ id: tag.id, name: tag.name, color: tag.color, kind: tag.kind })),
  };
}

/** Public row → list-item mapper (reused by the dashboard aggregation). */
export function toTradeListItem(t: TradeRow): TradeListItemDTO {
  return baseItem(t);
}

export function toTradeDetail(t: TradeDetailRow): TradeDetailDTO {
  let checklist: Record<string, boolean> | null = null;
  if (t.checklistResults) {
    try {
      checklist = JSON.parse(t.checklistResults) as Record<string, boolean>;
    } catch {
      checklist = null;
    }
  }
  return {
    ...baseItem(t),
    marketCondition: t.marketCondition,
    mfePrice: s(t.mfePrice),
    maePrice: s(t.maePrice),
    initialStopLoss: s(t.initialStopLoss),
    initialTakeProfit: s(t.initialTakeProfit),
    riskAmount: s(t.riskAmount),
    commission: t.commission.toString(),
    swap: t.swap.toString(),
    fees: t.fees.toString(),
    grossPnl: s(t.grossPnl),
    pnlSource: t.pnlSource,
    points: s(t.points),
    realizedRR: s(t.realizedRR),
    emotionDuring: t.emotionDuring,
    emotionAfter: t.emotionAfter,
    confidence: t.confidence,
    setupQualityRating: t.setupQualityRating,
    executionRating: t.executionRating,
    lessonLearned: t.lessonLearned,
    preTradeAnalysis: t.preTradeAnalysis,
    postTradeReview: t.postTradeReview,
    notes: t.notes,
    tradingViewUrl: t.tradingViewUrl,
    checklistResults: checklist,
    accountCurrency: t.account.currency,
    accountInitialBalance: t.account.initialBalance.toString(),
    screenshots: t.screenshots.map((sc) => ({
      id: sc.id,
      label: sc.label,
      caption: sc.caption,
      createdAt: sc.createdAt.toISOString(),
      url: `/api/uploads/${sc.id}`,
    })),
    executions: t.executions.map((e) => ({
      id: e.id,
      type: e.type,
      time: e.time.toISOString(),
      price: e.price.toString(),
      lots: e.lots.toString(),
      commission: e.commission.toString(),
      pnl: s(e.pnl),
    })),
    hasReview: t.review !== null,
    // v2.5 M2 — price chart overlay sources (defensive: call sites with a
    // lighter include still work)
    modifications: (t.modifications ?? []).map((m) => ({
      id: m.id,
      time: m.time.toISOString(),
      field: m.field,
      oldValue: m.oldValue,
      newValue: m.newValue,
      source: m.source,
    })),
    newsEvents: (t.eventLinks ?? []).map((l) => ({
      id: l.event.id,
      title: l.event.title,
      time: l.event.scheduledAt.toISOString(),
      importance: l.event.impact,
    })),
  };
}

// ── Ownership resolution ─────────────────────────────────────────────────────

async function resolveAccount(userId: string, accountId: string): Promise<Account> {
  const account = await db.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new TradeValidationError("ACCOUNT_NOT_FOUND", 422);
  return account;
}

async function resolveInstrument(userId: string, instrumentId: string): Promise<Instrument> {
  const instrument = await db.instrument.findFirst({
    where: { id: instrumentId, OR: [{ userId: null }, { userId }] },
  });
  if (!instrument) throw new TradeValidationError("INSTRUMENT_NOT_FOUND", 422);
  return instrument;
}

async function resolveStrategy(userId: string, strategyId: string | null | undefined) {
  if (!strategyId) return null;
  const strategy = await db.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new TradeValidationError("STRATEGY_NOT_FOUND", 422);
  return strategy;
}

async function filterOwnTags(userId: string, tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await db.tag.findMany({
    where: { id: { in: tagIds }, OR: [{ userId: null }, { userId }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Balance of an account at a point in time: initial + cash flows + closed P&L. */
export async function computeBalanceAt(
  userId: string,
  accountId: string,
  at: Date
): Promise<Decimal> {
  const account = await resolveAccount(userId, accountId);
  let balance = toD(account.initialBalance);
  const cash = await db.cashTransaction.aggregate({
    _sum: { amount: true },
    where: { accountId, date: { lt: at } },
  });
  balance = balance.plus(toD(cash._sum.amount ?? 0));
  const pnl = await db.trade.aggregate({
    _sum: { netPnl: true },
    where: {
      userId,
      accountId,
      status: "CLOSED",
      isDraft: false,
      exitTime: { lt: at },
    },
  });
  balance = balance.plus(toD(pnl._sum.netPnl ?? 0));
  return balance;
}

// ── Derived fields (pure-ish, engine-driven) ────────────────────────────────

export interface ComputeParams {
  instrument: Instrument;
  account: Account;
  direction: string;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  lots: string;
  commission: string;
  swap: string;
  fees: string;
  quoteToAccountRate: string | null | undefined;
  pnlSource: string;
  manualNetPnl: string | null | undefined;
  entryTime: Date;
  balanceAtEntry: Decimal | null;
}

export function computeDerived(p: ComputeParams) {
  const spec = toInstrumentSpec(p.instrument);
  const direction = p.direction as "LONG" | "SHORT";
  const closed = p.exitPrice !== null && p.exitPrice !== undefined;

  let preview: TradePreview | null = null;
  if (p.exitPrice != null) {
    preview = previewTrade({
      instrument: spec,
      direction,
      lots: p.lots,
      entry: p.entryPrice,
      exit: p.exitPrice,
      commission: p.commission,
      swap: p.swap,
      fees: p.fees,
      quoteToAccountRate: p.quoteToAccountRate ?? null,
      accountCurrency: p.account.currency,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      accountBalance: p.balanceAtEntry,
    });
  } else {
    // Open trade: compute risk figures only (no exit).
    preview = null;
  }

  // R multiple from prices even without exit (planned) is NOT stored —
  // stored rMultiple is the realized one (closed only).
  let riskAmount: Decimal | null = null;
  let riskPercent: Decimal | null = null;
  const stopDist =
    p.stopLoss != null
      ? direction === "LONG"
        ? toD(p.entryPrice).minus(toD(p.stopLoss))
        : toD(p.stopLoss).minus(toD(p.entryPrice))
      : null;
  if (stopDist && stopDist.gt(0)) {
    riskAmount = stopDist
      .times(toD(p.lots))
      .times(toD(p.instrument.contractSize))
      .times(p.quoteToAccountRate ? toD(p.quoteToAccountRate) : toD(1));
    if (p.balanceAtEntry && p.balanceAtEntry.gt(0)) {
      // 6 dp: SQLite NUMERIC affinity truncates longer decimals to float64
      // on storage (e.g. "0.21983288304231124") — round to keep values exact.
      riskPercent = riskAmount
        .div(p.balanceAtEntry)
        .times(100)
        .toDecimalPlaces(6);
    }
  }

  // Planned RR
  let plannedRR: Decimal | null = null;
  if (stopDist && stopDist.gt(0) && p.takeProfit != null) {
    const reward = toD(p.takeProfit).minus(toD(p.entryPrice)).abs();
    if (reward.gt(0)) plannedRR = reward.div(stopDist).toDecimalPlaces(6);
  }

  const netPnl =
    p.pnlSource !== "CALCULATED" && p.manualNetPnl != null
      ? toD(p.manualNetPnl)
      : preview
        ? preview.netPnl
        : null;

  const rMultiple =
    preview && riskAmount && riskAmount.gt(0)
      ? preview.netPnl.div(riskAmount).toDecimalPlaces(6)
      : null;

  const resultType = closed
    ? classifyResult(netPnl ?? toD(0), rMultiple)
    : null;

  // Units
  const units = toD(p.lots).times(toD(p.instrument.contractSize));

  return {
    session: detectSessionSafe(p.entryTime),
    pips: preview ? preview.pips : null,
    points: preview ? preview.points : null,
    grossPnl: preview ? preview.grossPnl : null,
    netPnl,
    rMultiple,
    plannedRR,
    realizedRR: rMultiple,
    resultType,
    riskAmount,
    riskPercent,
    units,
    pnlCurrency: p.account.currency,
  };
}

// ── List ─────────────────────────────────────────────────────────────────────

/** Filter → Prisma where, shared by the list endpoint and the CSV export. */
export function tradeListWhere(
  userId: string,
  query: TradeListQuery
): Prisma.TradeWhereInput {
  return {
    userId,
    ...(query.includeDrafts ? {} : { isDraft: false }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.resultType ? { resultType: query.resultType } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
    ...(query.session ? { session: query.session } : {}),
    ...(query.timeframe ? { timeframe: query.timeframe } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.strategyId ? { strategyId: query.strategyId } : {}),
    ...(query.instrumentId ? { instrumentId: query.instrumentId } : {}),
    ...(query.symbol ? { instrument: { symbol: query.symbol } } : {}),
    ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
    ...(query.emotion ? { emotionBefore: query.emotion } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          entryTime: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { notes: { contains: query.search } },
            { preTradeAnalysis: { contains: query.search } },
            { postTradeReview: { contains: query.search } },
            { setupType: { contains: query.search } },
            { instrument: { symbol: { contains: query.search } } },
          ],
        }
      : {}),
  };
}

export async function listTrades(
  userId: string,
  query: TradeListQuery
): Promise<PaginatedDTO<TradeListItemDTO>> {
  const where = tradeListWhere(userId, query);

  // v2.5 M2 drill-down: local-hour / local-weekday filters are timezone-aware
  // and computed in JS (SQLite has no TZ support) — bounded fetch, filter,
  // then paginate in memory. Only used by chart drill-downs.
  if (query.entryHour != null || query.entryWeekday != null) {
    const profile = await db.profile.findUnique({ where: { id: userId } });
    const timezone = profile?.timezone ?? "UTC";
    const rows = await db.trade.findMany({
      where,
      include: {
        instrument: true,
        account: true,
        strategy: true,
        tags: { include: { tag: true } },
      },
      orderBy: { entryTime: "desc" },
      take: 5000,
    });
    const filtered = rows.filter((t) => {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "2-digit",
          hourCycle: "h23",
          weekday: "short",
        }).formatToParts(t.entryTime);
        const hour = parts.find((p) => p.type === "hour")?.value;
        const weekday = parts.find((p) => p.type === "weekday")?.value;
        const hourNum = hour != null ? Number.parseInt(hour, 10) : null;
        // Intl weekday "short" en-US: Sun..Sat → ISO 1-7 (Mon..Sun)
        const isoWeekday = weekday
          ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 1
          : null;
        if (query.entryHour != null && hourNum !== query.entryHour) return false;
        if (query.entryWeekday != null && isoWeekday !== query.entryWeekday) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
    const total = filtered.length;
    const pageRows = filtered.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize
    );
    return {
      data: pageRows.map(baseItem),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  const [total, rows] = await Promise.all([
    db.trade.count({ where }),
    db.trade.findMany({
      where,
      include: {
        instrument: true,
        account: true,
        strategy: true,
        tags: { include: { tag: true } },
      },
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map(baseItem),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getTradeDetail(
  userId: string,
  id: string
): Promise<TradeDetailDTO | null> {
  const trade = await db.trade.findFirst({
    where: { id, userId },
    include: DETAIL_INCLUDE,
  });
  return trade ? toTradeDetail(trade) : null;
}

// ── Create (idempotent by clientMutationId — v2 §4.2) ──────────────────────

export interface CreateTradeResult {
  trade: TradeDetailDTO;
  /** True when the clientMutationId already existed — no new row created. */
  deduplicated: boolean;
}

export async function createTrade(
  userId: string,
  input: TradeInput
): Promise<CreateTradeResult> {
  // Idempotency: replaying the same mutation returns the stored trade.
  if (input.clientMutationId) {
    const existing = await db.trade.findFirst({
      where: { userId, clientMutationId: input.clientMutationId },
      include: DETAIL_INCLUDE,
    });
    if (existing) return { trade: toTradeDetail(existing), deduplicated: true };
  }

  const [account, instrument, strategy] = await Promise.all([
    resolveAccount(userId, input.accountId),
    resolveInstrument(userId, input.instrumentId),
    resolveStrategy(userId, input.strategyId ?? null),
  ]);
  const tagIds = await filterOwnTags(userId, input.tagIds);

  const entryTime = new Date(input.entryTime);
  if (Number.isNaN(entryTime.getTime())) {
    throw new TradeValidationError("INVALID_DATE");
  }
  const closed = input.status === "CLOSED";
  if (closed && !input.exitPrice) {
    throw new TradeValidationError("EXIT_PRICE_REQUIRED");
  }
  const exitTime = input.exitTime ? new Date(input.exitTime) : closed ? new Date() : null;
  if (closed && (!exitTime || Number.isNaN(exitTime.getTime()))) {
    throw new TradeValidationError("INVALID_DATE");
  }

  const balanceAtEntry = await computeBalanceAt(userId, input.accountId, entryTime);

  const derived = computeDerived({
    instrument,
    account,
    direction: input.direction,
    entryPrice: input.entryPrice,
    exitPrice: closed ? (input.exitPrice ?? null) : null,
    stopLoss: input.stopLoss ?? null,
    takeProfit: input.takeProfit ?? null,
    lots: input.lots,
    commission: input.commission,
    swap: input.swap,
    fees: input.fees,
    quoteToAccountRate: input.quoteToAccountRate ?? null,
    pnlSource: input.pnlSource,
    manualNetPnl: input.manualNetPnl ?? null,
    entryTime,
    balanceAtEntry,
  });

  const created = await db.$transaction(async (tx) => {
    const trade = await tx.trade.create({
      data: {
        userId,
        accountId: input.accountId,
        strategyId: strategy?.id ?? null,
        instrumentId: input.instrumentId,
        externalId: null,
        direction: input.direction,
        orderType: input.orderType,
        status: input.status,
        timeframe: input.timeframe ?? null,
        session: derived.session,
        setupType: input.setupType ?? null,
        marketCondition: input.marketCondition ?? null,
        entryTime,
        exitTime,
        entryPrice: input.entryPrice,
        exitPrice: closed ? (input.exitPrice ?? null) : null,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        initialStopLoss: input.stopLoss ?? null,
        initialTakeProfit: input.takeProfit ?? null,
        mfePrice: input.mfePrice ?? null,
        maePrice: input.maePrice ?? null,
        lots: input.lots,
        units: derived.units,
        riskAmount: derived.riskAmount,
        riskPercent: derived.riskPercent,
        plannedRiskPercent: input.plannedRiskPercent ?? null,
        accountBalanceAtEntry: balanceAtEntry,
        pips: derived.pips,
        points: derived.points,
        grossPnl: derived.grossPnl,
        commission: input.commission,
        swap: input.swap,
        fees: input.fees,
        netPnl: derived.netPnl,
        pnlCurrency: derived.pnlCurrency,
        rMultiple: derived.rMultiple,
        plannedRR: derived.plannedRR,
        realizedRR: derived.realizedRR,
        resultType: derived.resultType,
        pnlSource: input.pnlSource,
        exitReason: input.exitReason ?? null,
        emotionBefore: input.emotionBefore ?? null,
        emotionDuring: input.emotionDuring ?? null,
        emotionAfter: input.emotionAfter ?? null,
        confidence: input.confidence ?? null,
        setupQualityRating: input.setupQualityRating ?? null,
        executionRating: input.executionRating ?? null,
        followedPlan: input.followedPlan ?? null,
        reviewStatus: input.reviewStatus,
        isDraft: input.isDraft,
        preTradeAnalysis: input.preTradeAnalysis,
        postTradeReview: input.postTradeReview,
        notes: input.notes ?? null,
        tradingViewUrl: input.tradingViewUrl || null,
        checklistResults: input.checklistResults
          ? JSON.stringify(input.checklistResults)
          : null,
        clientMutationId: input.clientMutationId ?? null,
        tags: {
          create: tagIds.map((tagId) => ({ tagId })),
        },
      },
    });
    // Initial execution row (aggregateExecutions-compatible).
    await tx.tradeExecution.create({
      data: {
        tradeId: trade.id,
        type: "ENTRY",
        time: entryTime,
        price: input.entryPrice,
        lots: input.lots,
        commission: input.commission,
      },
    });
    if (closed && exitTime) {
      await tx.tradeExecution.create({
        data: {
          tradeId: trade.id,
          type: "FINAL_EXIT",
          time: exitTime,
          price: input.exitPrice ?? input.entryPrice,
          lots: input.lots,
          commission: 0,
          pnl: derived.netPnl,
        },
      });
    }
    return trade;
  });

  const detail = await getTradeDetail(userId, created.id);
  if (!detail) throw new TradeValidationError("INTERNAL");
  // v2.5 M4 — maintain the normalized search column (§4.2).
  await refreshTradeSearchText(created.id);
  // Phase 6 — rule violation detection (best-effort, never fails the write).
  await evaluateTradeViolations(userId, created.id);
  return { trade: detail, deduplicated: false };
}

// ── Update (last-write-wins with conflict report — v2 §4.2) ─────────────────

export interface UpdateTradeResult {
  trade: TradeDetailDTO;
  /** Set when the client edited a stale version (LWW applied). */
  conflict: { baseUpdatedAt: string; serverUpdatedAt: string } | null;
}

export async function updateTrade(
  userId: string,
  id: string,
  patch: TradePatch
): Promise<UpdateTradeResult | null> {
  const current = await db.trade.findFirst({
    where: { id, userId },
    include: { instrument: true, account: true },
  });
  if (!current) return null;

  const conflict =
    patch.expectedUpdatedAt &&
    new Date(patch.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()
      ? {
          baseUpdatedAt: patch.expectedUpdatedAt,
          serverUpdatedAt: current.updatedAt.toISOString(),
        }
      : null;

  // Merge patch onto current values.
  const direction = (patch.direction ?? current.direction) as "LONG" | "SHORT";
  const status = patch.status ?? current.status;
  const entryPrice = patch.entryPrice ?? current.entryPrice.toString();
  const exitPrice =
    patch.exitPrice !== undefined ? patch.exitPrice : current.exitPrice?.toString() ?? null;
  const stopLoss =
    patch.stopLoss !== undefined ? patch.stopLoss : current.stopLoss?.toString() ?? null;
  const takeProfit =
    patch.takeProfit !== undefined
      ? patch.takeProfit
      : current.takeProfit?.toString() ?? null;
  const lots = patch.lots ?? current.lots.toString();
  const commission = patch.commission ?? current.commission.toString();
  const swap = patch.swap ?? current.swap.toString();
  const fees = patch.fees ?? current.fees.toString();
  const pnlSource = patch.pnlSource ?? current.pnlSource;
  const manualNetPnl =
    patch.manualNetPnl !== undefined
      ? patch.manualNetPnl
      : current.netPnl && current.pnlSource === "MANUAL"
        ? current.netPnl.toString()
        : null;
  const entryTime = patch.entryTime ? new Date(patch.entryTime) : current.entryTime;
  const exitTime =
    patch.exitTime !== undefined
      ? patch.exitTime
        ? new Date(patch.exitTime)
        : null
      : current.exitTime;

  if (status === "CLOSED" && !exitPrice) {
    throw new TradeValidationError("EXIT_PRICE_REQUIRED");
  }

  // Ownership of any changed relation.
  if (patch.accountId && patch.accountId !== current.accountId) {
    await resolveAccount(userId, patch.accountId);
  }
  if (patch.strategyId !== undefined) {
    await resolveStrategy(userId, patch.strategyId ?? null);
  }
  if (patch.instrumentId && patch.instrumentId !== current.instrumentId) {
    await resolveInstrument(userId, patch.instrumentId);
  }
  const tagIds =
    patch.tagIds !== undefined ? await filterOwnTags(userId, patch.tagIds) : null;

  const closed = status === "CLOSED" && exitPrice != null;
  const balanceAtEntry = patch.accountId
    ? await computeBalanceAt(userId, patch.accountId, entryTime)
    : current.accountBalanceAtEntry
      ? new Decimal(current.accountBalanceAtEntry)
      : await computeBalanceAt(userId, current.accountId, entryTime);

  const account = patch.accountId
    ? await resolveAccount(userId, patch.accountId)
    : current.account;
  const instrument = patch.instrumentId
    ? await resolveInstrument(userId, patch.instrumentId)
    : current.instrument;

  const derived = computeDerived({
    instrument,
    account,
    direction,
    entryPrice,
    exitPrice: closed ? exitPrice : null,
    stopLoss,
    takeProfit,
    lots,
    commission,
    swap,
    fees,
    quoteToAccountRate: patch.quoteToAccountRate ?? null,
    pnlSource,
    manualNetPnl,
    entryTime,
    balanceAtEntry,
  });

  // Initial SL/TP: never rewritten once set (moved-stop detection, v2 §4.9).
  const initialStopLoss =
    current.initialStopLoss?.toString() ?? (stopLoss ?? null);
  const initialTakeProfit =
    current.initialTakeProfit?.toString() ?? (takeProfit ?? null);

  await db.$transaction(async (tx) => {
    await tx.trade.update({
      where: { id: current.id },
      data: {
        accountId: patch.accountId ?? undefined,
        strategyId: patch.strategyId !== undefined ? patch.strategyId : undefined,
        instrumentId: patch.instrumentId ?? undefined,
        direction,
        orderType: patch.orderType ?? undefined,
        status,
        timeframe: patch.timeframe !== undefined ? patch.timeframe : undefined,
        session: derived.session ?? undefined,
        setupType: patch.setupType !== undefined ? patch.setupType : undefined,
        marketCondition:
          patch.marketCondition !== undefined ? patch.marketCondition : undefined,
        entryTime,
        exitTime: closed ? (exitTime ?? new Date()) : null,
        entryPrice,
        exitPrice: closed ? exitPrice : null,
        stopLoss,
        takeProfit,
        initialStopLoss,
        initialTakeProfit,
        mfePrice: patch.mfePrice !== undefined ? patch.mfePrice : undefined,
        maePrice: patch.maePrice !== undefined ? patch.maePrice : undefined,
        lots,
        units: derived.units,
        riskAmount: derived.riskAmount,
        riskPercent: derived.riskPercent,
        plannedRiskPercent:
          patch.plannedRiskPercent !== undefined ? patch.plannedRiskPercent : undefined,
        accountBalanceAtEntry: balanceAtEntry,
        pips: derived.pips,
        points: derived.points,
        grossPnl: derived.grossPnl,
        commission,
        swap,
        fees,
        netPnl: derived.netPnl,
        pnlCurrency: derived.pnlCurrency,
        rMultiple: derived.rMultiple,
        plannedRR: derived.plannedRR,
        realizedRR: derived.realizedRR,
        resultType: derived.resultType,
        pnlSource,
        exitReason: patch.exitReason !== undefined ? patch.exitReason : undefined,
        emotionBefore: patch.emotionBefore !== undefined ? patch.emotionBefore : undefined,
        emotionDuring: patch.emotionDuring !== undefined ? patch.emotionDuring : undefined,
        emotionAfter: patch.emotionAfter !== undefined ? patch.emotionAfter : undefined,
        confidence: patch.confidence !== undefined ? patch.confidence : undefined,
        setupQualityRating:
          patch.setupQualityRating !== undefined ? patch.setupQualityRating : undefined,
        executionRating:
          patch.executionRating !== undefined ? patch.executionRating : undefined,
        followedPlan: patch.followedPlan !== undefined ? patch.followedPlan : undefined,
        reviewStatus: patch.reviewStatus ?? undefined,
        isDraft: patch.isDraft !== undefined ? patch.isDraft : undefined,
        preTradeAnalysis: patch.preTradeAnalysis ?? undefined,
        postTradeReview: patch.postTradeReview ?? undefined,
        notes: patch.notes !== undefined ? patch.notes : undefined,
        tradingViewUrl: patch.tradingViewUrl !== undefined ? patch.tradingViewUrl : undefined,
        checklistResults:
          patch.checklistResults !== undefined
            ? patch.checklistResults
              ? JSON.stringify(patch.checklistResults)
              : null
            : undefined,
      },
    });
    if (tagIds !== null) {
      await tx.tradeTag.deleteMany({ where: { tradeId: current.id } });
      await tx.tradeTag.createMany({
        data: tagIds.map((tagId) => ({ tradeId: current.id, tagId })),
      });
    }
  });

  const trade = await getTradeDetail(userId, current.id);
  if (!trade) throw new TradeValidationError("INTERNAL");
  // v2.5 M4 — searchable text may have changed (notes, symbol, tags…).
  await refreshTradeSearchText(current.id);
  // Phase 6 — re-run rule detection (risk / P&L / day may have changed).
  await evaluateTradeViolations(userId, current.id);
  return { trade, conflict };
}

// ── Close an open trade (quick action, v2 §4.1) ─────────────────────────────

export async function closeTrade(
  userId: string,
  id: string,
  input: CloseTradeInput
): Promise<TradeDetailDTO | null> {
  const current = await db.trade.findFirst({
    where: { id, userId },
    include: { instrument: true, account: true },
  });
  if (!current) return null;
  if (current.status === "CLOSED") {
    throw new TradeValidationError("ALREADY_CLOSED");
  }

  const exitTime = input.exitTime ? new Date(input.exitTime) : new Date();
  const commission = input.commission ?? current.commission.toString();
  const swap = input.swap ?? current.swap.toString();
  const fees = input.fees ?? current.fees.toString();
  const pnlSource = input.pnlSource ?? current.pnlSource;

  const balanceAtEntry = current.accountBalanceAtEntry
    ? new Decimal(current.accountBalanceAtEntry)
    : await computeBalanceAt(userId, current.accountId, current.entryTime);

  const derived = computeDerived({
    instrument: current.instrument,
    account: current.account,
    direction: current.direction,
    entryPrice: current.entryPrice.toString(),
    exitPrice: input.exitPrice,
    stopLoss: current.stopLoss?.toString() ?? null,
    takeProfit: current.takeProfit?.toString() ?? null,
    lots: current.lots.toString(),
    commission,
    swap,
    fees,
    quoteToAccountRate: input.quoteToAccountRate ?? null,
    pnlSource,
    manualNetPnl: input.manualNetPnl ?? null,
    entryTime: current.entryTime,
    balanceAtEntry,
  });

  await db.$transaction(async (tx) => {
    await tx.trade.update({
      where: { id: current.id },
      data: {
        status: "CLOSED",
        exitTime,
        exitPrice: input.exitPrice,
        pips: derived.pips,
        points: derived.points,
        grossPnl: derived.grossPnl,
        netPnl: derived.netPnl,
        rMultiple: derived.rMultiple,
        plannedRR: derived.plannedRR,
        realizedRR: derived.realizedRR,
        resultType: derived.resultType,
        riskAmount: derived.riskAmount,
        riskPercent: derived.riskPercent,
        pnlSource,
        exitReason: input.exitReason ?? "MANUAL",
        commission,
        swap,
        fees,
      },
    });
    await tx.tradeExecution.create({
      data: {
        tradeId: current.id,
        type: "FINAL_EXIT",
        time: exitTime,
        price: input.exitPrice,
        lots: current.lots,
        commission: 0,
        pnl: derived.netPnl,
      },
    });
  });

  const trade = await getTradeDetail(userId, current.id);
  if (!trade) throw new TradeValidationError("INTERNAL");
  // Phase 6 — closing realizes the P&L: daily-loss rules re-evaluated.
  await evaluateTradeViolations(userId, current.id);
  return trade;
}

// ── Delete (v2.5 M4 §4.6: soft delete → trash, 30-day retention) ────────────

export async function deleteTrade(userId: string, id: string): Promise<boolean> {
  // Soft delete: children (executions, screenshots, tags, reviews) and the
  // (accountId, externalId) key are KEPT — restore brings everything back.
  // The daily cron purges rows trashed more than 30 days ago.
  const updated = await db.trade.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
  return updated.count > 0;
}
