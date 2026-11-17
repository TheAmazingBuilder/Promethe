/**
 * Strategy versions & per-strategy stats (v1 phase 5).
 *
 * Versions are IMMUTABLE snapshots: the full definition + checklist is frozen
 * as JSON at save time. No UPDATE endpoint by design (README addendum §11 —
 * "strategy_versions sans UPDATE — snapshots immuables").
 *
 * Stats reuse the analytics engine over the user's closed trades grouped by
 * strategyId — same convention as the dashboard strategyStats.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeTradeStats, type StatTrade } from "@/lib/analytics/engine";
import type {
  StrategyDetailPayload,
  StrategyStatsDTO,
  StrategyVersionDTO,
} from "@/lib/trading/dto";
import { toStrategyDTO } from "@/server/reference";
import { getDisplayPreferences } from "@/server/display-preferences";
import { tradingDayOfTrade } from "@/lib/time/trading-day";

interface SnapshotShape {
  name: string;
  description: string | null;
  color: string;
  status: string;
  timeframes: string[];
  defaultRiskPercent: string | null;
  targetRR: string | null;
  entryRules: string | null;
  exitRules: string | null;
  riskRules: string | null;
  checklistItems: Array<{
    label: string;
    category: string;
    order: number;
    isRequired: boolean;
  }>;
}

type VersionRow = Prisma.StrategyVersionGetPayload<Record<string, never>>;

function toVersionDTO(v: VersionRow): StrategyVersionDTO {
  let snapshot: SnapshotShape | null = null;
  try {
    const parsed = JSON.parse(v.snapshot);
    if (parsed && typeof parsed === "object") snapshot = parsed as SnapshotShape;
  } catch {
    snapshot = null;
  }
  const safe = snapshot ?? {
    name: "-",
    description: null,
    color: "#10b981",
    status: "ACTIVE",
    timeframes: [],
    defaultRiskPercent: null,
    targetRR: null,
    entryRules: null,
    exitRules: null,
    riskRules: null,
    checklistItems: [],
  };
  return {
    id: v.id,
    version: v.version,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    snapshot: {
      ...safe,
      // Defensive: arrays and fields must match the DTO contract.
      timeframes: Array.isArray(safe.timeframes) ? safe.timeframes : [],
      checklistItems: Array.isArray(safe.checklistItems) ? safe.checklistItems : [],
    },
  };
}

export async function listVersions(
  userId: string,
  strategyId: string
): Promise<StrategyVersionDTO[] | null> {
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return null;
  const rows = await db.strategyVersion.findMany({
    where: { strategyId },
    orderBy: { version: "desc" },
  });
  return rows.map(toVersionDTO);
}

/** Creates the next immutable snapshot of the CURRENT definition. */
export async function createVersion(
  userId: string,
  strategyId: string,
  note: string | null
): Promise<StrategyVersionDTO | null> {
  const strategy = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    include: { checklistItems: { orderBy: { order: "asc" } } },
  });
  if (!strategy) return null;

  const last = await db.strategyVersion.findFirst({
    where: { strategyId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const snapshot: SnapshotShape = {
    name: strategy.name,
    description: strategy.description,
    color: strategy.color,
    status: strategy.status,
    timeframes: (() => {
      try {
        const arr = JSON.parse(strategy.timeframesJson ?? "[]");
        return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
      } catch {
        return [];
      }
    })(),
    defaultRiskPercent: strategy.defaultRiskPercent?.toString() ?? null,
    targetRR: strategy.targetRR?.toString() ?? null,
    entryRules: strategy.entryRules,
    exitRules: strategy.exitRules,
    riskRules: strategy.riskRules,
    checklistItems: strategy.checklistItems.map((c) => ({
      label: c.label,
      category: c.category,
      order: c.order,
      isRequired: c.isRequired,
    })),
  };

  const created = await db.strategyVersion.create({
    data: {
      strategyId,
      version: (last?.version ?? 0) + 1,
      snapshot: JSON.stringify(snapshot),
      note,
    },
  });
  return toVersionDTO(created);
}

export async function deleteVersion(
  userId: string,
  strategyId: string,
  versionId: string
): Promise<boolean> {
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return false;
  const deleted = await db.strategyVersion.deleteMany({
    where: { id: versionId, strategyId },
  });
  return deleted.count > 0;
}

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
