/**
 * Per-strategy stats (v1 phase 5) + full detail payload.
 *
 * Stats reuse the analytics engine over the user's closed trades grouped by
 * strategyId — same convention as the dashboard strategyStats.
 *
 * Version snapshots live in ./strategy-versions (moved there so
 * reference.ts can freeze a snapshot before a definition edit without an
 * import cycle); they are re-exported here so existing callers keep working.
 */
import { db } from "@/lib/db";
import { computeTradeStats, type StatTrade } from "@/lib/analytics/engine";
import type {
  StrategyDetailPayload,
  StrategyStatsDTO,
} from "@/lib/trading/dto";
import { toStrategyDTO } from "@/server/reference";
import { getDisplayPreferences } from "@/server/display-preferences";
import { tradingDayOfTrade } from "@/lib/time/trading-day";

import { createVersion, deleteVersion, listVersions } from "./strategy-versions";

export { createVersion, deleteVersion, listVersions };

/** Stats over the user's closed non-draft trades grouped by strategy. */
export async function strategyStats(
  userId: string
): Promise<StrategyStatsDTO[]> {
  const [strategies, trades, profile, prefs] = await Promise.all([
    db.strategy.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, color: true, status: true },
    }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", isDraft: false },
      select: {
        id: true,
        entryTime: true,
        exitTime: true,
        netPnl: true,
        rMultiple: true,
        resultType: true,
        strategyId: true,
      },
    }),
    db.profile.findUnique({ where: { id: userId } }),
    getDisplayPreferences(userId),
  ]);

  const byId = new Map<string, StatTrade[]>();
  for (const t of trades) {
    if (t.strategyId == null) continue;
    const list = byId.get(t.strategyId);
    const stat: StatTrade = {
      id: t.id,
      exitTime: (t.exitTime ?? t.entryTime).toISOString(),
      entryTime: t.entryTime.toISOString(),
      netPnl: t.netPnl?.toString() ?? null,
      rMultiple: t.rMultiple?.toString() ?? null,
      resultType: t.resultType,
      strategyId: t.strategyId,
      instrumentId: "",
      symbol: "",
      direction: "",
      session: null,
      lots: null,
    };
    if (list) list.push(stat);
    else byId.set(t.strategyId, [stat]);
  }

  // Per-strategy "trading days" follow the user's trading-day setting.
  const dayOf = tradingDayOfTrade(
    profile?.timezone ?? "UTC",
    prefs.tradingDay
  );
  return strategies.map((s) => ({
    key: s.id,
    name: s.name,
    color: s.color,
    status: s.status,
    stats: computeTradeStats(byId.get(s.id) ?? [], { dayOf }),
    // Playbook extended fields default here; /api/playbook/* fills them in.
    sparklineR: [],
    expectancyR20: null,
    trades20: 0,
    underperforming: false,
  }));
}

/** Full detail payload: strategy + versions + stats. */
export async function strategyDetail(
  userId: string,
  strategyId: string
): Promise<StrategyDetailPayload | null> {
  const [strategy, versions, stats] = await Promise.all([
    db.strategy.findFirst({
      where: { id: strategyId, userId },
      include: { checklistItems: { orderBy: { order: "asc" } } },
    }),
    listVersions(userId, strategyId),
    strategyStats(userId),
  ]);
  if (!strategy || versions == null) return null;
  return {
    strategy: toStrategyDTO(strategy),
    versions,
    stats: stats.find((s) => s.key === strategyId) ?? null,
  };
}
