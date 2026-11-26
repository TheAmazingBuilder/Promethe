/**
 * Strategy versions (v1 phase 5, Playbook Phase 2).
 *
 * Versions are IMMUTABLE snapshots: the full definition + checklist is frozen
 * as JSON at save time. No UPDATE endpoint by design (README addendum §11 —
 * "strategy_versions sans UPDATE — snapshots immuables").
 *
 * Kept in its own module so `reference.ts` (updateStrategy) can freeze a
 * snapshot before a definition edit without an import cycle: this module
 * depends only on the DB and the DTO types.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { StrategyVersionDTO } from "@/lib/trading/dto";
import {
  diffStrategySnapshots,
  type SnapshotDiffRow,
} from "@/lib/playbook/version-diff";
import {
  versionPerformance,
  type VersionPerformanceRow,
} from "@/lib/playbook/version-performance";

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
  /** Strategy definition version frozen in this snapshot. */
  strategyVersion: number;
  /** Extended definition (Lot 11): snapshots used to freeze only the
   *  base fields, so an edit of entry conditions or the risk block left
   *  no trace of the old values. Old snapshots simply lack these keys. */
  detailedDescription: string | null;
  marketConditions: unknown[];
  entryConditions: unknown[];
  confirmations: unknown[];
  invalidations: string[];
  risk: Record<string, unknown> | null;
  tradeManagement: unknown[];
  exitPlan: unknown[];
  checklistItems: Array<{
    id: string;
    label: string;
    category: string;
    order: number;
    isRequired: boolean;
  }>;
}

type VersionRow = Prisma.StrategyVersionGetPayload<Record<string, never>>;

/** Lenient JSON helpers for the extended definition fields. */
function parseJsonArray(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringList(json: string | null | undefined): string[] {
  return parseJsonArray(json).filter(
    (v): v is string => typeof v === "string",
  );
}

function parseJsonObject(
  json: string | null | undefined,
): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parses a stored snapshot row; null when the JSON is unusable. */
function parseSnapshot(row: VersionRow): SnapshotShape | null {
  try {
    const parsed: unknown = JSON.parse(row.snapshot);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as SnapshotShape;
  } catch {
    return null;
  }
}

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
    strategyVersion: v.version,
    detailedDescription: null,
    marketConditions: [],
    entryConditions: [],
    confirmations: [],
    invalidations: [],
    risk: null,
    tradeManagement: [],
    exitPlan: [],
    checklistItems: [],
  };
  return {
    id: v.id,
    version: v.version,
    note: v.note,
    origin: v.origin,
    createdAt: v.createdAt.toISOString(),
    snapshot: {
      ...safe,
      strategyVersion:
        typeof safe.strategyVersion === "number"
          ? safe.strategyVersion
          : v.version,
      // Defensive: arrays and fields must match the DTO contract.
      timeframes: Array.isArray(safe.timeframes) ? safe.timeframes : [],
      checklistItems: Array.isArray(safe.checklistItems) ? safe.checklistItems : [],
    },
  };
}

export async function listVersions(
  userId: string,
  strategyId: string,
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
  note: string | null,
  origin: "MANUAL" | "AUTO" = "MANUAL",
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
    strategyVersion: strategy.version,
    detailedDescription: strategy.detailedDescription,
    marketConditions: parseJsonArray(strategy.marketConditionsJson),
    entryConditions: parseJsonArray(strategy.entryConditionsJson),
    confirmations: parseJsonArray(strategy.confirmationsJson),
    invalidations: parseStringList(strategy.invalidationsJson),
    risk: parseJsonObject(strategy.riskJson),
    tradeManagement: parseJsonArray(strategy.tradeManagementJson),
    exitPlan: parseJsonArray(strategy.exitPlanJson),
    checklistItems: strategy.checklistItems.map((c) => ({
      id: c.id,
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
      origin,
    },
  });
  return toVersionDTO(created);
}

/**
 * Deletes a snapshot. AUTO snapshots (frozen before a definition edit) are
 * never deletable — they are the audit trail of what trades were executed
 * under. Returns { protected: true } instead of deleting them.
 */
export async function deleteVersion(
  userId: string,
  strategyId: string,
  versionId: string,
): Promise<{ deleted: boolean; protected: boolean }> {
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return { deleted: false, protected: false };
  const row = await db.strategyVersion.findFirst({
    where: { id: versionId, strategyId },
    select: { origin: true },
  });
  if (!row) return { deleted: false, protected: false };
  if (row.origin === "AUTO") return { deleted: false, protected: true };
  const deleted = await db.strategyVersion.deleteMany({
    where: { id: versionId, strategyId },
  });
  return { deleted: deleted.count > 0, protected: false };
}

/**
 * Compares two snapshots of one strategy (Lot 11, roadmap §14).
 * `a` is the older version row id, `b` the newer one. Returns null when
 * the strategy is not owned or either snapshot is missing/unreadable.
 */
export async function compareStrategyVersions(
  userId: string,
  strategyId: string,
  idA: string,
  idB: string,
): Promise<{
  a: StrategyVersionDTO;
  b: StrategyVersionDTO;
  changes: SnapshotDiffRow[];
} | null> {
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return null;
  if (idA === idB) return null;
  const [rowA, rowB] = await Promise.all([
    db.strategyVersion.findFirst({ where: { id: idA, strategyId } }),
    db.strategyVersion.findFirst({ where: { id: idB, strategyId } }),
  ]);
  if (!rowA || !rowB) return null;
  const snapA = parseSnapshot(rowA);
  const snapB = parseSnapshot(rowB);
  if (!snapA || !snapB) return null;
  // Oldest first by creation, regardless of the order the caller passed.
  const [older, newer, olderSnap, newerSnap] =
    rowA.createdAt.getTime() <= rowB.createdAt.getTime()
      ? [rowA, rowB, snapA, snapB]
      : [rowB, rowA, snapB, snapA];
  return {
    a: toVersionDTO(older),
    b: toVersionDTO(newer),
    changes: diffStrategySnapshots(olderSnap, newerSnap),
  };
}

/**
 * Per-version performance of one strategy (Lot 11, roadmap §14).
 * Groups the user's closed non-draft trades by the definition version
 * frozen at entry, so results tie to the version actually traded under.
 * Returns null when the strategy is not owned.
 */
export async function strategyVersionPerformance(
  userId: string,
  strategyId: string,
): Promise<VersionPerformanceRow[] | null> {
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return null;
  const trades = await db.trade.findMany({
    where: { userId, strategyId, status: "CLOSED", isDraft: false },
    select: { strategyVersion: true, rMultiple: true, resultType: true },
  });
  return versionPerformance(
    trades.map((t) => ({
      strategyVersion: t.strategyVersion,
      rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
      resultType: t.resultType,
    })),
  );
}

/**
 * Checklist items frozen in the snapshot for a trade's definition
 * version (Lot 11, roadmap §14). The snapshot's `strategyVersion` is
 * the definition revision the trade froze at entry; the newest snapshot
 * carrying it wins. `id` is present on snapshots taken after Lot 11;
 * older snapshots only carry labels, so the caller resolves answers by
 * label against the live list. Returns null when no snapshot matches
 * (old trades, or snapshots deleted) - the caller then falls back to
 * the live list.
 */
export async function getFrozenChecklistItems(
  userId: string,
  strategyId: string,
  strategyVersion: number | null,
): Promise<Array<{ id?: string; label: string; isRequired: boolean }> | null> {
  if (strategyVersion == null) return null;
  const owned = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!owned) return null;
  const rows = await db.strategyVersion.findMany({
    where: { strategyId },
    orderBy: { createdAt: "desc" },
  });
  for (const row of rows) {
    const snapshot = parseSnapshot(row);
    if (snapshot && snapshot.strategyVersion === strategyVersion) {
      return (snapshot.checklistItems ?? []).map((item) => ({
        id: (item as { id?: string }).id,
        label: item.label,
        isRequired: item.isRequired,
      }));
    }
  }
  return null;
}

/**
 * Bulk frozen checklists for the cross-analysis loader (§25.7).
 *
 * Same rule as getFrozenChecklistItems, one query instead of one per
 * trade: every StrategyVersion row of the user's strategies, keyed
 * `${strategyId}:${snapshot.strategyVersion}`. A trade whose frozen
 * version has no matching snapshot simply has no entry here, and its
 * caller falls back to the live checklist - exactly like the detail
 * view. The newest snapshot carrying a version wins (rows are read
 * oldest-first so a later row overwrites an earlier one).
 */
export async function loadFrozenChecklistMap(
  userId: string
): Promise<
  Map<string, Array<{ id?: string; label: string; isRequired: boolean }>>
> {
  const rows = await db.strategyVersion.findMany({
    where: { strategy: { userId } },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<
    string,
    Array<{ id?: string; label: string; isRequired: boolean }>
  >();
  for (const row of rows) {
    const snapshot = parseSnapshot(row);
    if (snapshot == null) continue;
    map.set(`${row.strategyId}:${snapshot.strategyVersion}`, (
      snapshot.checklistItems ?? []
    ).map((item) => ({
      id: (item as { id?: string }).id,
      label: item.label,
      isRequired: item.isRequired,
    })));
  }
  return map;
}
