/**
 * v3 Phase 5 — Mentor read-only views (server-only).
 *
 * The SAME data-access pattern as the owner views, but every query goes
 * through the mentor AccessContext (account + strategy scope) and every
 * payload through the redaction engine BEFORE it leaves the server:
 * hidden fields are structurally absent, never CSS-hidden (v3 §4.4/§4.5).
 *
 * Mentors never see: profile/email/settings of the owner, other mentors,
 * share links, accounts outside their scope, or journal/psychology when
 * canViewJournal is false.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { UPLOAD_ROOT } from "@/server/uploads";
import { toTradeDetail, toTradeListItem } from "@/server/trades";
import { mentorTradeWhere, touchMentorView } from "@/server/mentors";
import {
  computeEquityCurve,
  computeTradeStats,
  groupStats,
  type StatTrade,
} from "@/lib/analytics/engine";
import { toD } from "@/lib/trading/dec";
import { getDisplayPreferences } from "@/server/display-preferences";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { AccessContext, AccessScope } from "@/lib/access";
import {
  redactEquityCurve,
  redactStats,
  redactTrade,
  type CurvePoint,
  type RedactionPolicy,
} from "@/lib/redaction";

/**
 * Maps a mentor scope to a redaction policy. Amounts hidden → account info
 * hidden too (balances ARE amounts). Journal scope off → notes + psychology.
 * Exact times stay visible (mentors are not the public web).
 */
export function mentorPolicyFrom(scope: AccessScope): RedactionPolicy {
  return {
    hideAmounts: !scope.canViewAmounts,
    hideAccountInfo: !scope.canViewAmounts,
    hideNotes: !scope.canViewJournal,
    hideScreenshots: !scope.canViewScreenshots,
    hideStrategyName: false,
    hideExactTimes: false,
    hidePsychology: !scope.canViewJournal,
  };
}

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// ── trades list ──────────────────────────────────────────────────────────────

export interface MentorTradeListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  direction?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  reviewStatus?: string;
}

const LIST_AMOUNT_KEYS = ["lots", "netPnl", "pnlCurrency", "riskPercent"];
const LIST_ACCOUNT_KEYS = ["accountId", "accountName"];
const LIST_PSYCH_KEYS = ["emotionBefore", "followedPlan"];

function redactListItem(
  item: Record<string, unknown>,
  policy: RedactionPolicy
): Record<string, unknown> {
  let out = { ...item };
  if (policy.hideAmounts) {
    for (const key of LIST_AMOUNT_KEYS) delete out[key];
  }
  if (policy.hideAccountInfo) {
    for (const key of LIST_ACCOUNT_KEYS) delete out[key];
  }
  if (policy.hidePsychology) {
    for (const key of LIST_PSYCH_KEYS) delete out[key];
  }
  return out;
}

const TRADE_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
} as const;

export async function listMentorTrades(
  ctx: AccessContext,
  query: MentorTradeListQuery
): Promise<{
  data: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  policy: RedactionPolicy;
}> {
  const policy = mentorPolicyFrom(ctx.scope);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, query.pageSize ?? 20));

  const base = mentorTradeWhere(ctx);
  const where: Prisma.TradeWhereInput = {
    ...base,
    ...(query.status ? { status: query.status } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
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
    ...(query.dateFrom || query.dateTo
      ? {
          entryTime: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.trade.count({ where }),
    db.trade.findMany({
      where,
      include: TRADE_INCLUDE,
      orderBy: { entryTime: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  await touchMentorView(ctx, "TRADES");

  return {
    data: rows.map((row) =>
      redactListItem(toTradeListItem(row) as unknown as Record<string, unknown>, policy)
    ),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    policy,
  };
}

// ── trade detail ─────────────────────────────────────────────────────────────

export async function getMentorTradeDetail(
  ctx: AccessContext,
  tradeId: string
): Promise<{
  trade: Record<string, unknown>;
  policy: RedactionPolicy;
} | null> {
  const policy = mentorPolicyFrom(ctx.scope);

  const trade = await db.trade.findFirst({
    where: { ...mentorTradeWhere(ctx), id: tradeId },
    include: {
      instrument: true,
      account: true,
      strategy: true,
      tags: { include: { tag: true } },
      screenshots: { orderBy: { createdAt: "asc" } },
      executions: { orderBy: { time: "asc" } },
      review: { select: { id: true, playbookMatch: true } },
    },
  });
  if (!trade) return null;

  await touchMentorView(ctx, "TRADE_DETAIL", tradeId);

  const dto = toTradeDetail(trade) as unknown as Record<string, unknown>;
  const redacted = redactTrade(dto, policy);

  // Screenshots (when allowed) stream through the mentor proxy so revoking
  // the access kills image access immediately.
  const out = redacted.trade;
  if (Array.isArray(out.screenshots)) {
    out.screenshots = (out.screenshots as Record<string, unknown>[]).map((shot) => ({
      ...shot,
      url: `/api/v1/mentor/${ctx.ownerId}/media/${String(shot.id)}`,
    }));
  }
  return { trade: out, policy };
}

/** Streams a screenshot to a scoped mentor (canViewScreenshots enforced). */
export async function readMentorMedia(
  ctx: AccessContext,
  screenshotId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!ctx.scope.canViewScreenshots) return null;

  const shot = await db.tradeScreenshot.findUnique({
    where: { id: screenshotId },
    include: { trade: { select: { id: true, accountId: true, strategyId: true } } },
  });
  if (!shot || shot.userId !== ctx.ownerId) return null;

  // Scope check against the trade the screenshot belongs to.
  const inAccount =
    ctx.scope.accountIds === "ALL" || ctx.scope.accountIds.includes(shot.trade.accountId);
  const inStrategy =
    ctx.scope.strategyIds === "ALL" ||
    !shot.trade.strategyId ||
    ctx.scope.strategyIds.includes(shot.trade.strategyId);
  if (!inAccount || !inStrategy) return null;

  const ext = shot.storagePath.split(".").pop() ?? "";
  try {
    const buffer = await readFile(path.join(UPLOAD_ROOT, shot.storagePath));
    return { buffer, contentType: EXT_MIME[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

// ── journal (scope-gated) ────────────────────────────────────────────────────

export async function listMentorJournal(
  ctx: AccessContext,
  page = 1,
  pageSize = 20
): Promise<{
  entries: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
} | null> {
  if (!ctx.scope.canViewJournal) return null;
  const safePageSize = Math.min(50, Math.max(5, pageSize));

  const [total, entries] = await Promise.all([
    db.journalEntry.count({ where: { userId: ctx.ownerId } }),
    db.journalEntry.findMany({
      where: { userId: ctx.ownerId },
      orderBy: { date: "desc" },
      skip: (page - 1) * safePageSize,
      take: safePageSize,
    }),
  ]);

  await touchMentorView(ctx, "JOURNAL");

  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      preMarketPlan: entry.preMarketPlan,
      postMarketReview: entry.postMarketReview,
      mood: entry.mood,
      sleepQuality: entry.sleepQuality,
      disciplineScore: entry.disciplineScore,
      keyLesson: entry.keyLesson,
      marketBias: entry.marketBias,
    })),
    total,
    page,
    pageSize: safePageSize,
  };
}

// ── analytics (computed on scoped trades only) ───────────────────────────────

function toStatTrade(t: {
  id: string;
  exitTime: Date | null;
  entryTime: Date;
  netPnl: Prisma.Decimal | null;
  rMultiple: Prisma.Decimal | null;
  resultType: string | null;
  strategyId: string | null;
  strategyName: string | null;
  instrumentId: string;
  symbol: string;
  direction: string;
  session: string | null;
  lots: Prisma.Decimal;
}): StatTrade {
  return {
    id: t.id,
    exitTime: (t.exitTime ?? t.entryTime).toISOString(),
    entryTime: t.entryTime.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyId: t.strategyId,
    strategyName: t.strategyName,
    instrumentId: t.instrumentId,
    symbol: t.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
  };
}

export async function getMentorAnalytics(
  ctx: AccessContext
): Promise<Record<string, unknown> | null> {
  if (!ctx.scope.canViewAnalytics) return null;
  const policy = mentorPolicyFrom(ctx.scope);

  const where: Prisma.TradeWhereInput = {
    ...mentorTradeWhere(ctx),
    status: "CLOSED",
  };
  const rows = await db.trade.findMany({
    where,
    include: TRADE_INCLUDE,
  });
  const statTrades = rows.map((row) =>
    toStatTrade({
      id: row.id,
      exitTime: row.exitTime,
      entryTime: row.entryTime,
      netPnl: row.netPnl,
      rMultiple: row.rMultiple,
      resultType: row.resultType,
      strategyId: row.strategyId,
      strategyName: row.strategy?.name ?? null,
      instrumentId: row.instrumentId,
      symbol: row.instrument.symbol,
      direction: row.direction,
      session: row.session,
      lots: row.lots,
    })
  );

  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const last30 = statTrades.filter(
    (t) => new Date(t.exitTime).getTime() >= cutoff
  );

  // The mentor reads the OWNER's journal: KPI "trading days" follow the
  // owner's trading-day setting (default MIDNIGHT_LOCAL = previous
  // behaviour), in the owner's timezone.
  const [ownerProfile, ownerPrefs] = await Promise.all([
    db.profile.findUnique({ where: { id: ctx.ownerId } }),
    getDisplayPreferences(ctx.ownerId),
  ]);
  const ownerTimezone = ownerProfile?.timezone ?? "UTC";
  const dayOf = tradingDayOfTrade(ownerTimezone, ownerPrefs.tradingDay);
  const kpisAllTime =
    statTrades.length > 0 ? computeTradeStats(statTrades, { dayOf }) : null;
  const kpis30d =
    last30.length > 0 ? computeTradeStats(last30, { dayOf }) : null;

  // Equity curve — percent-normalized when amounts are hidden.
  const sorted = [...statTrades].sort(
    (a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime()
  );
  let cumulative = toD(0);
  const points: CurvePoint[] = [];
  for (const t of sorted) {
    cumulative = cumulative.plus(toD(t.netPnl ?? 0));
    points.push({ time: t.exitTime.slice(0, 10), value: cumulative.toNumber() });
  }
  const curve = redactEquityCurve(points, policy, "PERCENT");

  const byStrategy = groupStats(statTrades, (t) => t.strategyName ?? null);
  const strategyStats = byStrategy.map((g) =>
    redactStats(
      { ...g, name: g.key } as unknown as Record<string, unknown>,
      policy
    )
  );

  const [openCount, toReviewCount] = await Promise.all([
    db.trade.count({ where: { ...mentorTradeWhere(ctx), status: "OPEN" } }),
    db.trade.count({
      where: { ...mentorTradeWhere(ctx), reviewStatus: "NOT_REVIEWED" },
    }),
  ]);

  await touchMentorView(ctx, "ANALYTICS");

  return {
    tradeCount: statTrades.length,
    kpisAllTime: kpisAllTime ? redactStats(kpisAllTime as unknown as Record<string, unknown>, policy) : null,
    kpis30d: kpis30d ? redactStats(kpis30d as unknown as Record<string, unknown>, policy) : null,
    equityCurve: curve.points,
    equityUnit: curve.unit,
    strategyStats,
    openCount,
    toReviewCount,
    policyFlags: {
      amountsVisible: ctx.scope.canViewAmounts,
      journalVisible: ctx.scope.canViewJournal,
    },
  };
}
