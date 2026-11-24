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
  calcPlannedRR,
  classifyResult,
  type TradePreview,
} from "@/lib/trading/calculate";
import { detectSessionSafe } from "@/lib/trading/session";
import { resolveConversionRate, type FxRateInput } from "@/lib/tools/fx";
import {
  detectSessionFromSettings,
  type MarketSessionSettingEntry,
} from "@/lib/tools/market-hours";
import {
  getDetectionSettings,
  listFxRateInputs,
  resolveExitPlan,
} from "@/server/tools";
import type { InstrumentSpec } from "@/lib/trading/types";
import type {
  CloseTradeInput,
  TradeInput,
  TradeListQuery,
  TradePatch,
} from "@/lib/validations/trade";
import type {
  TagDTO,
  TradeAnomalyFlagDTO,
  TradeDetailDTO,
  TradeListItemDTO,
  TradesListPayload,
} from "@/lib/trading/dto";
import {
  computeGridStats,
  gridStatsFromCounts,
  type GridStats,
} from "@/lib/trades/grid-stats";
import { evaluateTradeViolations } from "@/server/rules";
import { checkDrawdownAlerts } from "@/server/integrations/delivery";
import { refreshTradeSearchText } from "@/server/search-index";
import { foldText } from "@/lib/search/text";
import {
  buildCustomFieldsSchema,
  parseCustomFields,
  serializeCustomFields,
} from "@/lib/custom-fields/validate";
import { activeCustomFieldDefinitions } from "@/server/custom-fields";
import { expiryDate, newGroupId } from "@/server/change-log";

/** Validation/ownership errors - mapped to typed API responses by the routes. */
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

/**
 * Minimal row shape baseItem reads: every trade scalar plus only the
 * relation fields the list item exposes (symbol/digits, account name,
 * strategy name + deletedAt for the soft-delete rule, tag id/name/color/
 * kind + deletedAt). The full include satisfies it — and so does a
 * narrowed select (dashboard aggregation), so the mapper never sees a
 * field outside this shape.
 */
export type TradeListRow = Omit<
  TradeRow,
  "instrument" | "account" | "strategy" | "tags"
> & {
  instrument: Pick<TradeRow["instrument"], "symbol" | "digits">;
  account: Pick<TradeRow["account"], "name">;
  strategy:
    | Pick<NonNullable<TradeRow["strategy"]>, "name" | "deletedAt">
    | null;
  tags: Array<{
    tag: Pick<
      TradeRow["tags"][number]["tag"],
      "id" | "name" | "color" | "kind" | "deletedAt"
    >;
  }>;
};

type TradeFullRow = Prisma.TradeGetPayload<{
  include: {
    instrument: true;
    account: true;
    strategy: true;
    tags: { include: { tag: true } };
    screenshots: true;
    executions: { orderBy: { time: "asc" } };
    review: { select: { id: true, playbookMatch: true, followedPlan: true, planAdherenceScore: true, executionQuality: true, entryQuality: true, exitQuality: true, riskManagementScore: true, emotionalControlScore: true, wouldTakeAgain: true, mainLesson: true, whatWentWell: true, whatToImprove: true, mistakeTagIds: true, customAnswers: true, reviewedAt: true, createdAt: true, updatedAt: true } };
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
  review: TradeFullRow["review"];
};

/** Shared include for every TradeDetailDTO mapper call site. */
const DETAIL_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
  screenshots: { orderBy: { createdAt: "asc" } },
  executions: { orderBy: { time: "asc" } },
  review: { select: { id: true, playbookMatch: true, followedPlan: true, planAdherenceScore: true, executionQuality: true, entryQuality: true, exitQuality: true, riskManagementScore: true, emotionalControlScore: true, wouldTakeAgain: true, mainLesson: true, whatWentWell: true, whatToImprove: true, mistakeTagIds: true, customAnswers: true, reviewedAt: true, createdAt: true, updatedAt: true } },
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

function baseItem(t: TradeListRow): TradeListItemDTO {
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
    setupId: t.setupId,
    strategyVersion: t.strategyVersion,
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
    grade: t.grade,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    currentPrice: s(t.currentPrice),
    tags: t.tags
      .filter((tt) => tt.tag.deletedAt == null)
      .map((tt) => tt.tag)
      .map((tag): TagDTO => ({ id: tag.id, name: tag.name, color: tag.color, kind: tag.kind })),
    customFields: parseCustomFields(t.customFields),
  };
}

/** Public row → list-item mapper (reused by the dashboard aggregation). */
export function toTradeListItem(t: TradeListRow): TradeListItemDTO {
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
    exitPlanId: t.exitPlanId,
    playbookMatch: t.review?.playbookMatch ?? null,
    review: t.review ? {
      id: t.review.id,
      playbookMatch: t.review.playbookMatch,
      followedPlan: t.review.followedPlan,
      planAdherenceScore: t.review.planAdherenceScore,
      executionQuality: t.review.executionQuality,
      entryQuality: t.review.entryQuality,
      exitQuality: t.review.exitQuality,
      riskManagementScore: t.review.riskManagementScore,
      emotionalControlScore: t.review.emotionalControlScore,
      wouldTakeAgain: t.review.wouldTakeAgain,
      mainLesson: t.review.mainLesson,
      whatWentWell: t.review.whatWentWell,
      whatToImprove: t.review.whatToImprove,
      mistakeTagIds: parseReviewTagIds(t.review.mistakeTagIds),
      customAnswers: parseCustomReviewAnswers(t.review.customAnswers),
      reviewedAt: t.review.reviewedAt.toISOString(),
      updatedAt: t.review.updatedAt.toISOString(),
    } : null,
    currentPrice: s(t.currentPrice),
    screenshots: t.screenshots.map((sc) => ({
      id: sc.id,
      label: sc.label,
      caption: sc.caption,
      createdAt: sc.createdAt.toISOString(),
      url: `/api/v1/uploads/${sc.id}`,
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
    hasReview: Boolean(t.review && (t.review.followedPlan !== null || t.review.planAdherenceScore !== null || t.review.executionQuality !== null || t.review.entryQuality !== null || t.review.exitQuality !== null || t.review.riskManagementScore !== null || t.review.emotionalControlScore !== null || t.review.wouldTakeAgain !== null || t.review.mainLesson || t.review.whatWentWell || t.review.whatToImprove || t.review.mistakeTagIds || (t.review.customAnswers && t.review.customAnswers !== "[]"))),
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

function parseReviewTagIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
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

/** Playbook setup, owned by the user and attached to the given strategy. */
async function resolveSetup(
  userId: string,
  setupId: string | null | undefined,
  strategyId: string | null | undefined,
) {
  if (!setupId) return null;
  const setup = await db.setup.findFirst({ where: { id: setupId, userId } });
  if (!setup) throw new TradeValidationError("SETUP_NOT_FOUND", 422);
  if (strategyId != null && setup.strategyId !== strategyId) {
    throw new TradeValidationError("SETUP_STRATEGY_MISMATCH", 422);
  }
  return setup;
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
  /** Stored FxRate table: default conversion when no manual rate is set. */
  fxRates?: FxRateInput[] | null;
  /** User DETECTION settings (null = legacy UTC defaults). */
  detectionSettings?: MarketSessionSettingEntry[] | null;
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
      fxRates: p.fxRates ?? null,
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
    // Manual rate wins; otherwise use the stored FX table. Without a valid
    // quote→account rate, account-currency risk is unknown and must stay null.
    const effectiveRate = resolveConversionRate(
      p.instrument.quoteCurrency ?? "",
      p.account.currency,
      p.fxRates ?? [],
      p.quoteToAccountRate ?? null
    );
    if (effectiveRate && effectiveRate.isFinite() && effectiveRate.gt(0)) {
      riskAmount = stopDist
        .times(toD(p.lots))
        .times(toD(p.instrument.contractSize))
        .times(effectiveRate);
      if (p.balanceAtEntry && p.balanceAtEntry.gt(0)) {
        // 6 dp: SQLite NUMERIC affinity truncates longer decimals to float64
        // on storage (e.g. "0.21983288304231124") — round to keep values exact.
        riskPercent = riskAmount
          .div(p.balanceAtEntry)
          .times(100)
          .toDecimalPlaces(6);
      }
    }
  }

  // Keep the server-side planned ratio aligned with the direction-aware
  // calculation used by the client and trade preview.
  const planned = calcPlannedRR(
    direction,
    p.entryPrice,
    p.stopLoss,
    p.takeProfit
  );
  const plannedRR = planned?.toDecimalPlaces(6) ?? null;

  const netPnl =
    p.pnlSource !== "CALCULATED" && p.manualNetPnl != null
      ? toD(p.manualNetPnl)
      : preview
        ? preview.netPnl
        : null;

  const rMultiple =
    netPnl !== null && riskAmount && riskAmount.gt(0)
      ? netPnl.div(riskAmount).toDecimalPlaces(6)
      : null;

  const resultType = closed
    ? classifyResult(netPnl ?? toD(0), rMultiple)
    : null;

  // Units
  const units = toD(p.lots).times(toD(p.instrument.contractSize));

  return {
    session: p.detectionSettings
      ? detectSessionFromSettings(p.entryTime, p.detectionSettings)
      : detectSessionSafe(p.entryTime),
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
    ...(query.grade
      ? query.grade === "UNGRADED"
        ? { grade: null }
        : { grade: query.grade }
      : {}),
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
          // v2.5 Module 4 — accent-insensitive search over the maintained
          // searchText column (symbol, setup, notes, analyses, lesson,
          // broker comment, tag names, custom-field values). Multi-term
          // queries AND the folded terms.
          AND: foldText(query.search)
            .split(/\s+/)
            .filter(Boolean)
            .map((term) => ({ searchText: { contains: term } })),
        }
      : {}),
    ...(query.customFieldKey && query.customFieldValue
      ? {
          // SELECT custom-field filter: exact JSON fragment match.
          customFields: {
            contains: `"${query.customFieldKey}":"${query.customFieldValue}"`,
          },
        }
      : {}),
  };
}

/**
 * v2.5 M2 drill-down: local-hour / local-weekday match, timezone-aware.
 * SQLite has no TZ support, so the filter runs in JS over a bounded
 * fetch (take 5000) — shared by the list and the stats endpoints.
 */
function matchesEntryDrilldown(
  entryTime: Date,
  timezone: string,
  query: Pick<TradeListQuery, "entryHour" | "entryWeekday">
): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(entryTime);
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
}

export async function listTrades(
  userId: string,
  query: TradeListQuery
): Promise<TradesListPayload> {
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
    const filtered = rows.filter((t) =>
      matchesEntryDrilldown(t.entryTime, timezone, query)
    );
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
      anomalies: await listAnomalyFlags(
        userId,
        pageRows.map((t) => t.id)
      ),
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
    anomalies: await listAnomalyFlags(
      userId,
      rows.map((t) => t.id)
    ),
  };
}

/**
 * Header stats over the WHOLE filtered set (grid view) — aggregated in
 * SQL instead of paging the list endpoint one page at a time. Same
 * filters as listTrades, same numbers as computeGridStats over the same
 * rows (one shared math function, gridStatsFromCounts).
 *
 * Drill-down filters (entryHour/entryWeekday) still need the bounded
 * 5000-row JS-filter path (SQLite has no TZ support) — one narrow query,
 * still one HTTP call.
 */
export async function getGridStats(
  userId: string,
  query: TradeListQuery
): Promise<GridStats> {
  const where = tradeListWhere(userId, query);

  if (query.entryHour != null || query.entryWeekday != null) {
    const profile = await db.profile.findUnique({ where: { id: userId } });
    const timezone = profile?.timezone ?? "UTC";
    const rows = await db.trade.findMany({
      where,
      select: {
        entryTime: true,
        resultType: true,
        netPnl: true,
        pnlCurrency: true,
      },
      orderBy: { entryTime: "desc" },
      take: 5000,
    });
    const filtered = rows.filter((t) =>
      matchesEntryDrilldown(t.entryTime, timezone, query)
    );
    return computeGridStats(
      filtered.map((t) => ({
        resultType: t.resultType,
        netPnl: t.netPnl?.toString() ?? null,
        pnlCurrency: t.pnlCurrency,
      }))
    );
  }

  const [byResult, total, byCurrency] = await Promise.all([
    db.trade.groupBy({
      by: ["resultType"],
      where,
      _count: { _all: true },
    }),
    db.trade.aggregate({
      where,
      _count: { _all: true },
      _sum: { netPnl: true },
    }),
    db.trade.groupBy({
      by: ["pnlCurrency"],
      where,
      _count: { _all: true },
    }),
  ]);
  const resultCounts = new Map(
    byResult.map((g) => [g.resultType, g._count._all] as const)
  );
  return gridStatsFromCounts({
    count: total._count._all,
    wins: resultCounts.get("WIN") ?? 0,
    losses: resultCounts.get("LOSS") ?? 0,
    breakevens: resultCounts.get("BREAKEVEN") ?? 0,
    netPnl: total._sum.netPnl?.toString() ?? "0",
    currencies: new Map(
      byCurrency.map((g) => [g.pnlCurrency, g._count._all] as const)
    ),
  });
}

/**
 * Persisted anomaly flags for the given trades (TradeAnomaly rows written
 * by the advanced analytics computation). One indexed lookup, no
 * recalculation — the /trades badge column reads these rows instead of
 * triggering a full analytics run. Empty until an advanced computation
 * has run at least once; the /analytics/anomalies tab still computes
 * live and refreshes the rows.
 */
async function listAnomalyFlags(
  userId: string,
  tradeIds: string[]
): Promise<TradeAnomalyFlagDTO[]> {
  if (tradeIds.length === 0) return [];
  const rows = await db.tradeAnomaly.findMany({
    where: { userId, tradeId: { in: tradeIds } },
    select: { tradeId: true, kind: true, severity: true, zScore: true },
  });
  return rows.map((r) => ({
    tradeId: r.tradeId,
    kind: r.kind,
    severity: r.severity,
    zScore: r.zScore.toNumber(),
  }));
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
  /** True when the clientMutationId already existed - no new row created. */
  deduplicated: boolean;
}

/** Validate custom-field values against the live definitions (non-drafts
 * only) and serialize them in definition order. Unknown keys are dropped.
 * Drafts skip validation so a half-filled field never blocks saving. */
async function resolveCustomFields(
  userId: string,
  values: Record<string, unknown> | null | undefined,
  opts: { validate: boolean }
): Promise<string | null> {
  if (!values) return null;
  const defs = await activeCustomFieldDefinitions(userId);
  if (opts.validate) {
    const parsed = buildCustomFieldsSchema(defs).safeParse(values);
    if (!parsed.success) {
      throw new TradeValidationError("CUSTOM_FIELDS_INVALID");
    }
  }
  return serializeCustomFields(values, defs);
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

  // Playbook — the setup must belong to the chosen strategy, and the trade
  // freezes the strategy's current definition version at entry.
  const setup = await resolveSetup(
    userId,
    input.setupId ?? null,
    input.strategyId ?? null,
  );

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

  const customFieldsJson = await resolveCustomFields(userId, input.customFields, {
    validate: !input.isDraft,
  });

  // v2.5 Module 5 — stored FX rates feed calcPnL (manual rate still wins)
  // and the user's DETECTION settings drive the session. Both are
  // best-effort: missing tools tables fall back to no rates / defaults.
  const [fxRates, detectionSettings] = await Promise.all([
    listFxRateInputs(userId),
    getDetectionSettings(userId),
  ]);
  await resolveExitPlan(userId, input.exitPlanId ?? null);

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
    fxRates,
    detectionSettings,
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
        setupId: setup?.id ?? null,
        strategyVersion: strategy?.version ?? null,
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
        exitPlanId: input.exitPlanId ?? null,
        currentPrice: input.currentPrice ?? null,
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
        grade: input.grade ?? null,
        reviewStatus: input.reviewStatus,
        isDraft: input.isDraft,
        preTradeAnalysis: input.preTradeAnalysis,
        postTradeReview: input.postTradeReview,
        notes: input.notes ?? null,
        tradingViewUrl: input.tradingViewUrl || null,
        checklistResults: input.checklistResults
          ? JSON.stringify(input.checklistResults)
          : null,
        customFields: customFieldsJson,
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
  // Changing strategy re-freezes the definition version at the new
  // strategy's current version; clearing it clears the frozen version.
  let frozenVersion: number | null | undefined;
  if (patch.strategyId !== undefined) {
    const nextStrategy = await resolveStrategy(userId, patch.strategyId ?? null);
    frozenVersion = nextStrategy?.version ?? null;
  }
  if (patch.setupId !== undefined) {
    const effectiveStrategyId =
      patch.strategyId !== undefined ? patch.strategyId : current.strategyId;
    await resolveSetup(userId, patch.setupId ?? null, effectiveStrategyId);
  }
  if (patch.instrumentId && patch.instrumentId !== current.instrumentId) {
    await resolveInstrument(userId, patch.instrumentId);
  }
  const tagIds =
    patch.tagIds !== undefined ? await filterOwnTags(userId, patch.tagIds) : null;

  const customFieldsJson =
    patch.customFields !== undefined
      ? await resolveCustomFields(userId, patch.customFields, {
          validate: patch.isDraft !== true,
        })
      : undefined;

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

  // v2.5 Module 5 — stored FX rates + DETECTION settings (best-effort).
  const [fxRates, detectionSettings] = await Promise.all([
    listFxRateInputs(userId),
    getDetectionSettings(userId),
  ]);
  if (patch.exitPlanId !== undefined) {
    await resolveExitPlan(userId, patch.exitPlanId);
  }

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
    fxRates,
    detectionSettings,
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
        setupId: patch.setupId !== undefined ? patch.setupId : undefined,
        strategyVersion: frozenVersion,
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
        exitPlanId:
          patch.exitPlanId !== undefined ? patch.exitPlanId : undefined,
        currentPrice:
          patch.currentPrice !== undefined ? patch.currentPrice : undefined,
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
        grade: patch.grade !== undefined ? patch.grade : undefined,
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
        customFields:
          patch.customFields !== undefined ? customFieldsJson : undefined,
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

  const [fxRates, detectionSettings] = await Promise.all([
    listFxRateInputs(userId),
    getDetectionSettings(userId),
  ]);

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
    fxRates,
    detectionSettings,
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
  // v2.5 Module 9 — drawdown / prop alerts (best effort: a failure here
  // must never fail the close; checkDrawdownAlerts never throws).
  await checkDrawdownAlerts(userId, current.accountId);
  return trade;
}

// ── Delete (v2.5 M4 §4.6: soft delete → trash, 30-day retention) ────────────

export async function deleteTrade(userId: string, id: string): Promise<boolean> {
  // Soft delete: children (executions, screenshots, tags, reviews) and the
  // (accountId, externalId) key are KEPT — restore brings everything back.
  // The daily cron purges rows trashed more than 30 days ago.
  // v2.5 Module 4 — the delete is logged as a one-trade ChangeLog group so
  // it can be undone from /history (or with Cmd+Z) within 30 days.
  const current = await db.trade.findFirst({
    where: { id, userId, deletedAt: null },
    select: {
      id: true,
      strategyId: true,
      accountId: true,
      customFields: true,
      deletedAt: true,
      tags: { select: { tagId: true } },
    },
  });
  if (!current) return false;
  const before = {
    strategyId: current.strategyId,
    accountId: current.accountId,
    tagIds: current.tags.map((t) => t.tagId),
    customFields: parseCustomFields(current.customFields),
    deletedAt: null as string | null,
  };
  await db.$transaction(async (tx) => {
    await tx.trade.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    await tx.changeLog.create({
      data: {
        userId,
        groupId: newGroupId(),
        entity: "TRADE",
        entityId: id,
        action: "DELETE",
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify({ ...before, deletedAt: new Date().toISOString() }),
        source: "UI",
        expiresAt: expiryDate(),
      },
    });
  });
  return true;
}


// ── Structured post-trade review ──────────────────────────────────────────────

export type TradeReviewInput = {
  customAnswers?: Array<{ questionId: string; answer: string | number | boolean | null }>
  playbookMatch?: "MATCHED" | "PARTIAL" | "OFF_PLAYBOOK" | null;
  followedPlan?: boolean | null;
  planAdherenceScore?: number | null;
  executionQuality?: number | null;
  entryQuality?: number | null;
  exitQuality?: number | null;
  riskManagementScore?: number | null;
  emotionalControlScore?: number | null;
  wouldTakeAgain?: "YES" | "NO" | "MAYBE" | null;
  mainLesson?: string | null;
  whatWentWell?: string | null;
  whatToImprove?: string | null;
  mistakeTagIds?: string[];
};

function parseCustomReviewAnswers(raw: string | null): Array<{ questionId: string; question: string; type: "SCALE" | "BOOLEAN" | "TEXT"; answer: string | number | boolean }> {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is { questionId: string; question: string; type: "SCALE" | "BOOLEAN" | "TEXT"; answer: string | number | boolean } => {
      if (typeof item !== "object" || item === null) return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.questionId === "string" && typeof entry.question === "string" && ["SCALE", "BOOLEAN", "TEXT"].includes(String(entry.type)) && (typeof entry.answer === "string" || typeof entry.answer === "number" || typeof entry.answer === "boolean");
    });
  } catch { return []; }
}

export async function saveTradeReview(
  userId: string,
  tradeId: string,
  input: TradeReviewInput
) {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true },
  });
  if (!trade) return null;

  const mistakeTagIds = await filterOwnTags(userId, input.mistakeTagIds ?? []);
  const data = {
    ...(input.playbookMatch !== undefined ? { playbookMatch: input.playbookMatch } : {}),
    ...(input.followedPlan !== undefined ? { followedPlan: input.followedPlan } : {}),
    ...(input.planAdherenceScore !== undefined ? { planAdherenceScore: input.planAdherenceScore } : {}),
    ...(input.executionQuality !== undefined ? { executionQuality: input.executionQuality } : {}),
    ...(input.entryQuality !== undefined ? { entryQuality: input.entryQuality } : {}),
    ...(input.exitQuality !== undefined ? { exitQuality: input.exitQuality } : {}),
    ...(input.riskManagementScore !== undefined ? { riskManagementScore: input.riskManagementScore } : {}),
    ...(input.emotionalControlScore !== undefined ? { emotionalControlScore: input.emotionalControlScore } : {}),
    ...(input.wouldTakeAgain !== undefined ? { wouldTakeAgain: input.wouldTakeAgain } : {}),
    ...(input.mainLesson !== undefined ? { mainLesson: input.mainLesson } : {}),
    ...(input.whatWentWell !== undefined ? { whatWentWell: input.whatWentWell } : {}),
    ...(input.whatToImprove !== undefined ? { whatToImprove: input.whatToImprove } : {}),
    ...(input.mistakeTagIds !== undefined ? { mistakeTagIds: JSON.stringify(mistakeTagIds) } : {}),
  };

  return db.$transaction(async (tx) => {
    let customAnswersJson: string | undefined;
    if (input.customAnswers !== undefined) {
      const previous = await tx.tradeReview.findUnique({ where: { tradeId }, select: { customAnswers: true } });
      const previousSnapshots = parseCustomReviewAnswers(previous?.customAnswers ?? null);
      const requestedIds = input.customAnswers.map((answer) => answer.questionId);
      const templates = requestedIds.length ? await tx.reviewQuestionTemplate.findMany({ where: { userId, id: { in: requestedIds }, isActive: true } }) : [];
      if (templates.length !== new Set(requestedIds).size) throw new TradeValidationError("INVALID_REVIEW_QUESTION");
      const submittedIds = new Set(requestedIds);
      const snapshots = input.customAnswers.flatMap((entry) => {
        const template = templates.find((item) => item.id === entry.questionId);
        if (!template) throw new TradeValidationError("INVALID_REVIEW_QUESTION");
        const previousSnapshot = previousSnapshots.find((snapshot) => snapshot.questionId === entry.questionId);
        if (entry.answer === null) {
          // A changed template must not erase an older answer merely because
          // its previous value no longer matches the new answer control.
          return previousSnapshot && (previousSnapshot.question !== template.question || previousSnapshot.type !== template.type)
            ? [previousSnapshot]
            : [];
        }
        const valid = template.type === "SCALE" ? typeof entry.answer === "number" && Number.isInteger(entry.answer) && entry.answer >= 1 && entry.answer <= 5 : template.type === "BOOLEAN" ? typeof entry.answer === "boolean" : template.type === "TEXT" && typeof entry.answer === "string" && entry.answer.trim().length > 0 && entry.answer.length <= 2000;
        if (!valid) throw new TradeValidationError("INVALID_REVIEW_ANSWER");
        // Keep the original question snapshot when the answer itself did not
        // change. A new answer records the edited question wording/type.
        if (previousSnapshot && Object.is(previousSnapshot.answer, entry.answer)) return [previousSnapshot];
        return [{ questionId: template.id, question: template.question, type: template.type as "SCALE" | "BOOLEAN" | "TEXT", answer: entry.answer }];
      });
      const archivedSnapshots = previousSnapshots.filter((snapshot) => !submittedIds.has(snapshot.questionId));
      customAnswersJson = JSON.stringify([...archivedSnapshots, ...snapshots]);
    }
    const review = await tx.tradeReview.upsert({
      where: { tradeId },
      create: {
        tradeId,
        userId,
        playbookMatch: input.playbookMatch ?? null,
        followedPlan: input.followedPlan ?? null,
        planAdherenceScore: input.planAdherenceScore ?? null,
        executionQuality: input.executionQuality ?? null,
        entryQuality: input.entryQuality ?? null,
        exitQuality: input.exitQuality ?? null,
        riskManagementScore: input.riskManagementScore ?? null,
        emotionalControlScore: input.emotionalControlScore ?? null,
        wouldTakeAgain: input.wouldTakeAgain ?? null,
        mainLesson: input.mainLesson ?? null,
        whatWentWell: input.whatWentWell ?? null,
        whatToImprove: input.whatToImprove ?? null,
        mistakeTagIds: input.mistakeTagIds !== undefined ? JSON.stringify(mistakeTagIds) : null,
        customAnswers: customAnswersJson ?? null,
      },
      update: { ...data, ...(customAnswersJson !== undefined ? { customAnswers: customAnswersJson } : {}) },
    });
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        reviewStatus: "REVIEWED",
        ...(input.followedPlan !== undefined ? { followedPlan: input.followedPlan } : {}),
      },
    });
    return review;
  });
}
