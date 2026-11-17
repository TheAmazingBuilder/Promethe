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
    strategyVersion: v.version,
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
