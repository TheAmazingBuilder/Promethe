/**
 * v3 — Report payload builder (server): period stats for REPORT share links.
 *
 * Shares reuse the v1 analytics engine over the owner's CLOSED trades in the
 * chosen period (optionally one account). The payload is raw here — the
 * redaction engine runs afterwards (and again at read time for LIVE links).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal } from "@/lib/trading/dec";
import {
  computeEquityCurve,
  computeTradeStats,
  groupStats,
  type StatTrade,
} from "@/lib/analytics/engine";
import { D0, toD } from "@/lib/trading/dec";
import type { PublicReportBreakdownRow, PublicReportPayload } from "./types";

export interface ReportPeriod {
  /** Inclusive YYYY-MM-DD. */
  start: string;
  /** Inclusive YYYY-MM-DD. */
  end: string;
  accountId?: string | null;
}

export function parseReportPeriod(value: unknown): ReportPeriod | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const { start, end } = raw;
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  if (startDate.getTime() > endDate.getTime()) return null;
  const accountId = raw.accountId;
  return {
    start,
    end,
    accountId: typeof accountId === "string" && accountId.length > 0 ? accountId : null,
  };
}

function toStatTrade(t: {
  id: string;
  exitTime: Date | null;
  entryTime: Date;
  netPnl: Decimal | string | null;
  rMultiple: Decimal | string | null;
  resultType: string | null;
  strategyId: string | null;
  instrumentId: string;
  direction: string;
  session: string | null;
  lots: Decimal | string;
  instrument: { symbol: string };
  strategy?: { name: string } | null;
}): StatTrade {
  const dec = (v: Decimal | string | null): string | null =>
    v === null || v === undefined ? null : v.toString();
  return {
    id: t.id,
    // status = CLOSED is a query precondition; entryTime is the fallback.
    exitTime: (t.exitTime ?? t.entryTime).toISOString(),
    entryTime: t.entryTime.toISOString(),
    netPnl: dec(t.netPnl),
    rMultiple: dec(t.rMultiple),
    resultType: t.resultType,
    strategyId: t.strategyId,
    strategyName: t.strategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: dec(t.lots),
  };
}

function breakdown(
  groups: Array<{ key: string; stats: ReturnType<typeof computeTradeStats> }>,
  nameOf: (key: string) => string
): PublicReportBreakdownRow[] {
  return groups.map((g) => ({
    key: g.key,
    name: nameOf(g.key),
    tradeCount: g.stats.tradeCount,
    winRate: g.stats.winRate,
    netPnl: g.stats.netPnl,
    totalR: g.stats.totalR,
    avgR: g.stats.avgR,
    profitFactor: g.stats.profitFactor,
  }));
}

/**
 * Builds the RAW report payload for a period. `title` is the share title.
 * Deterministic and side-effect free (pure DB read + engine).
 */
export async function buildReportPayload(
  userId: string,
  period: ReportPeriod,
  title: string,
  mode: "SNAPSHOT" | "LIVE"
): Promise<Omit<PublicReportPayload, "policy">> {
  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    exitTime: {
      gte: new Date(`${period.start}T00:00:00.000Z`),
      lte: new Date(`${period.end}T23:59:59.999Z`),
    },
    ...(period.accountId ? { accountId: period.accountId } : {}),
  };

  const rows = await db.trade.findMany({
    where,
    include: { instrument: true, strategy: true, account: true },
    orderBy: { exitTime: "asc" },
  });

  const trades = rows.map(toStatTrade);
  const stats = computeTradeStats(trades);

  // Initial balance over the involved accounts (equity baseline). For
  // hidden-amounts reports the curve is later converted to % or R anyway.
  const accountIds = new Set(rows.map((r) => r.accountId));
  const initialBalance =
    accountIds.size === 0
      ? D0
      : rows
          .filter((r, i, arr) => arr.findIndex((x) => x.accountId === r.accountId) === i)
          .reduce((acc, r) => acc.plus(toD(r.account.initialBalance)), D0);

  const equityCurve = computeEquityCurve(trades, initialBalance);
  const risks = trades.map((t) => Number(t.rMultiple ?? 0));

  const byStrategy = breakdown(
    groupStats(trades, (t) => t.strategyId ?? "__none__"),
    (key) => {
      if (key === "__none__") return "-";
      return trades.find((t) => t.strategyId === key)?.strategyName ?? key;
    }
  );
  const bySymbol = breakdown(
    groupStats(trades, (t) => t.symbol),
    (key) => key
  );

  return {
    kind: "REPORT",
    title,
    mode,
    capturedAt: new Date().toISOString(),
    period: { start: period.start, end: period.end },
    stats: {
      ...stats,
      tradeCount: stats.tradeCount,
      initialBalance: initialBalance.toString(),
      currency: rows[0]?.account?.currency ?? "USD",
    },
    equity: {
      // Number values are fine for the chart; redaction converts later.
      points: equityCurve.map((p) => ({
        time: p.date,
        value: Number(p.equity),
      })),
      unit: "CURRENCY" as const,
    },
    byStrategy,
    bySymbol,
  };
}
