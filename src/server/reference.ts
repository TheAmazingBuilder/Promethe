/**
 * Reference data — strategies, accounts, tags, saved views (userId-scoped).
 * Minimal CRUD backing the trade form selectors and filter bars.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { refreshStrategySearchText } from "@/server/search-index";
import type {
  AccountDTO,
  SavedViewDTO,
  StrategyDTO,
  TagDTO,
} from "@/lib/trading/dto";
import type {
  accountInputSchema,
  savedViewInputSchema,
  strategyInputSchema,
  tagInputSchema,
  tagPatchSchema,
} from "@/lib/validations/trade";
import type { z } from "zod";

// ── Strategies ───────────────────────────────────────────────────────────────

function parseStringArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type StrategyRow = Prisma.StrategyGetPayload<{
  include: { checklistItems: { orderBy: { order: "asc" } } };
}>;

export function toStrategyDTO(s: StrategyRow): StrategyDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    color: s.color,
    status: s.status,
    timeframes: parseStringArray(s.timeframesJson),
    defaultRiskPercent: s.defaultRiskPercent?.toString() ?? null,
    targetRR: s.targetRR?.toString() ?? null,
    entryRules: s.entryRules,
    exitRules: s.exitRules,
    riskRules: s.riskRules,
    checklistItems: s.checklistItems.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      order: c.order,
      isRequired: c.isRequired,
    })),
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listStrategies(userId: string): Promise<StrategyDTO[]> {
  const rows = await db.strategy.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
    include: { checklistItems: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toStrategyDTO);
}

export async function createStrategy(
  userId: string,
  input: z.infer<typeof strategyInputSchema>
): Promise<StrategyDTO> {
  // Checklist replace-all: rows are created with the strategy.
  const created = await db.strategy.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color,
      status: input.status,
      timeframesJson: JSON.stringify(input.timeframes ?? []),
      defaultRiskPercent: input.defaultRiskPercent ?? null,
      targetRR: input.targetRR ?? null,
      entryRules: input.entryRules ?? null,
      exitRules: input.exitRules ?? null,
      riskRules: input.riskRules ?? null,
      ...(input.checklistItems != null
        ? {
            checklistItems: {
              create: input.checklistItems.map((c, i) => ({
                label: c.label,
                category: c.category,
                order: c.order ?? i,
                isRequired: c.isRequired,
              })),
            },
          }
        : {}),
    },
    include: { checklistItems: { orderBy: { order: "asc" } } },
  });
  // v2.5 M4 — normalized search column (§4.2).
  await refreshStrategySearchText(created.id);
  return toStrategyDTO(created);
}

export async function updateStrategy(
  userId: string,
  id: string,
  patch: Partial<z.infer<typeof strategyInputSchema>>
): Promise<StrategyDTO | null> {
  const existing = await db.strategy.findFirst({ where: { id, userId } });
  if (!existing) return null;

  // Checklist replace-all (v1 phase 5): delete + recreate inside the same
  // transaction as the strategy update. Omitted on PATCH → untouched.
  const [updated] = await db.$transaction([
    db.strategy.update({
      where: { id: existing.id },
      data: {
        name: patch.name ?? undefined,
        description: patch.description !== undefined ? patch.description : undefined,
        color: patch.color ?? undefined,
        status: patch.status ?? undefined,
        timeframesJson:
          patch.timeframes !== undefined
            ? JSON.stringify(patch.timeframes)
            : undefined,
        defaultRiskPercent:
          patch.defaultRiskPercent !== undefined ? patch.defaultRiskPercent : undefined,
        targetRR: patch.targetRR !== undefined ? patch.targetRR : undefined,
        entryRules: patch.entryRules !== undefined ? patch.entryRules : undefined,
        exitRules: patch.exitRules !== undefined ? patch.exitRules : undefined,
        riskRules: patch.riskRules !== undefined ? patch.riskRules : undefined,
      },
    }),
    ...(patch.checklistItems != null
      ? [
          db.strategyChecklistItem.deleteMany({
            where: { strategyId: existing.id },
          }),
        ]
      : []),
  ]);

  if (patch.checklistItems != null) {
    // Recreate rows one by one — SQLite batch createMany is not needed at
    // this scale (≤ 60 items).
    for (const [i, c] of patch.checklistItems.entries()) {
      await db.strategyChecklistItem.create({
        data: {
          strategyId: existing.id,
          label: c.label,
          category: c.category,
          order: c.order ?? i,
          isRequired: c.isRequired,
        },
      });
    }
    await pruneTemplateChecklistRefs(userId, existing.id);
  }

  const row = await db.strategy.findFirst({
    where: { id: existing.id },
    include: { checklistItems: { orderBy: { order: "asc" } } },
  });
  if (row) {
    // v2.5 M4 — searchable text may have changed (name, rules…).
    await refreshStrategySearchText(row.id);
  }
  return row ? toStrategyDTO(row) : null;
}

/**
 * After a checklist replace-all, item ids change — drop dead references from
 * the user's trade templates (best-effort housekeeping, ids are a JSON array).
 * Scans ALL templates of the user: a template may reference checklist items
 * without being bound to the strategy (selector set at template-edit time).
 */
async function pruneTemplateChecklistRefs(
  userId: string,
  strategyId: string
): Promise<void> {
  const [liveIds, templates] = await Promise.all([
    db.strategyChecklistItem.findMany({
      where: { strategyId },
      select: { id: true },
    }),
    db.tradeTemplate.findMany({
      where: { userId },
      select: { id: true, defaultChecklistItemIds: true },
    }),
  ]);
  const live = new Set(liveIds.map((i) => i.id));
  for (const tpl of templates) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(tpl.defaultChecklistItemIds ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      ids = [];
    }
    // Only rewrite when the array actually references one of the replaced ids.
    const touched = ids.some((id) => !live.has(id) && id.length > 0);
    if (!touched) continue;
    const kept = ids.filter((id) => live.has(id));
    if (kept.length !== ids.length) {
      await db.tradeTemplate.update({
        where: { id: tpl.id },
        data: { defaultChecklistItemIds: JSON.stringify(kept) },
      });
    }
  }
}

export async function deleteStrategy(userId: string, id: string): Promise<boolean> {
  // v2.5 M4 — soft delete → trash: trades KEEP their strategyId (the FK is
  // no longer set to null) and DTOs hide the trashed strategy until it is
  // restored. Versions and checklist items are kept as children.
  const updated = await db.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
  return updated.count > 0;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;

export function toAccountDTO(a: AccountRow): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    broker: a.broker,
    type: a.type,
    currency: a.currency,
    initialBalance: a.initialBalance.toString(),
    leverage: a.leverage,
    isActive: a.isActive,
    maxDailyLossPercent: a.maxDailyLossPercent?.toString() ?? null,
    maxTotalDrawdownPercent: a.maxTotalDrawdownPercent?.toString() ?? null,
    profitTarget: a.profitTarget?.toString() ?? null,
    drawdownType: a.drawdownType,
    startDate: a.startDate?.toISOString() ?? null,
    marginCallLevel: a.marginCallLevel?.toString() ?? null,
    stopOutLevel: a.stopOutLevel?.toString() ?? null,
    serverTimezoneMode: a.serverTimezoneMode,
    serverTimezone: a.serverTimezone,
    serverFixedOffsetMinutes: a.serverFixedOffsetMinutes,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listAccounts(userId: string): Promise<AccountDTO[]> {
  const rows = await db.account.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toAccountDTO);
}

export async function createAccount(
  userId: string,
  input: z.infer<typeof accountInputSchema>
): Promise<AccountDTO> {
  const created = await db.account.create({
    data: {
      userId,
      name: input.name,
      broker: input.broker ?? null,
      type: input.type,
      currency: input.currency,
      initialBalance: input.initialBalance,
      leverage: input.leverage ?? null,
      isActive: input.isActive,
      maxDailyLossPercent: input.maxDailyLossPercent ?? null,
      maxTotalDrawdownPercent: input.maxTotalDrawdownPercent ?? null,
      profitTarget: input.profitTarget ?? null,
      drawdownType: input.drawdownType ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      marginCallLevel: input.marginCallLevel ?? null,
      stopOutLevel: input.stopOutLevel ?? null,
      serverTimezoneMode: input.serverTimezoneMode ?? "IANA",
      serverTimezone: input.serverTimezone ?? null,
      serverFixedOffsetMinutes: input.serverFixedOffsetMinutes ?? null,
    },
  });
  return toAccountDTO(created);
}

export async function updateAccount(
  userId: string,
  id: string,
  patch: Partial<z.infer<typeof accountInputSchema>>
): Promise<AccountDTO | null> {
  const existing = await db.account.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const updated = await db.account.update({
    where: { id: existing.id },
    data: {
      name: patch.name ?? undefined,
      broker: patch.broker !== undefined ? patch.broker : undefined,
      type: patch.type ?? undefined,
      currency: patch.currency ?? undefined,
      initialBalance: patch.initialBalance ?? undefined,
      leverage: patch.leverage !== undefined ? patch.leverage : undefined,
      isActive: patch.isActive ?? undefined,
      maxDailyLossPercent:
        patch.maxDailyLossPercent !== undefined ? patch.maxDailyLossPercent : undefined,
      maxTotalDrawdownPercent:
        patch.maxTotalDrawdownPercent !== undefined
          ? patch.maxTotalDrawdownPercent
          : undefined,
      profitTarget: patch.profitTarget !== undefined ? patch.profitTarget : undefined,
      drawdownType: patch.drawdownType !== undefined ? patch.drawdownType : undefined,
      marginCallLevel:
        patch.marginCallLevel !== undefined ? patch.marginCallLevel : undefined,
      stopOutLevel:
        patch.stopOutLevel !== undefined ? patch.stopOutLevel : undefined,
      serverTimezoneMode:
        patch.serverTimezoneMode != null
          ? patch.serverTimezoneMode
          : undefined,
      serverTimezone:
        patch.serverTimezone !== undefined
          ? patch.serverTimezone
          : undefined,
      serverFixedOffsetMinutes:
        patch.serverFixedOffsetMinutes !== undefined
          ? patch.serverFixedOffsetMinutes
          : undefined,
      startDate:
        patch.startDate !== undefined
          ? patch.startDate
            ? new Date(patch.startDate)
            : null
          : undefined,
    },
  });
  return toAccountDTO(updated);
}

export async function deleteAccount(userId: string, id: string): Promise<boolean> {
  const hasTrades = await db.trade.findFirst({
    where: { accountId: id, userId },
    select: { id: true },
  });
  if (hasTrades) return false; // accounts with history are never deleted
  const deleted = await db.account.deleteMany({ where: { id, userId } });
  return deleted.count > 0;
}

// ── Tags (global presets + user-owned) ───────────────────────────────────────

export async function listTags(userId: string): Promise<TagDTO[]> {
  const rows = await db.tag.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    orderBy: [{ userId: "desc" }, { kind: "asc" }, { name: "asc" }],
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    kind: t.kind,
    isPreset: t.userId == null,
  }));
}

export async function createTag(
  userId: string,
  input: z.infer<typeof tagInputSchema>
): Promise<TagDTO> {
  const existing = await db.tag.findFirst({
    where: { userId, name: input.name },
  });
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      color: existing.color,
      kind: existing.kind,
      isPreset: false,
    };
  }
  const created = await db.tag.create({
    data: { userId, name: input.name, color: input.color, kind: input.kind },
  });
  return {
    id: created.id,
    name: created.name,
    color: created.color,
    kind: created.kind,
    isPreset: false,
  };
}

export async function deleteTag(userId: string, id: string): Promise<boolean> {
  // v2.5 M4 — soft delete → trash: TradeTag rows are kept (children); trade
  // DTOs filter the trashed tag out until it is restored.
  const updated = await db.tag.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
  return updated.count > 0;
}

/** Rename / recolor a USER-OWNED tag (presets are never editable). */
export async function updateTag(
  userId: string,
  id: string,
  patch: z.infer<typeof tagPatchSchema>
): Promise<TagDTO | null> {
  const existing = await db.tag.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const updated = await db.tag.update({
    where: { id: existing.id },
    data: {
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.color != null ? { color: patch.color } : {}),
      ...(patch.kind != null ? { kind: patch.kind } : {}),
    },
  });
  return {
    id: updated.id,
    name: updated.name,
    color: updated.color,
    kind: updated.kind,
    isPreset: false,
  };
}

// ── Saved views (named filter presets) ──────────────────────────────────────

/** Parse the optional JSON columns/sort/grouping of a SavedView row. */
function parseViewJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSavedViewDTO(row: {
  id: string;
  page: string;
  name: string;
  filtersJson: string;
  columnsJson: string | null;
  sortJson: string | null;
  groupingJson: string | null;
  entity: string | null;
  isPinned: boolean;
  isDefault: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}): SavedViewDTO {
  return {
    id: row.id,
    page: row.page,
    name: row.name,
    filters: parseViewJson<Record<string, unknown>>(row.filtersJson, {}),
    columns: parseViewJson<string[] | null>(row.columnsJson, null),
    sort: parseViewJson<Array<{ id: string; desc: boolean }> | null>(
      row.sortJson,
      null
    ),
    grouping: parseViewJson<Record<string, unknown> | null>(
      row.groupingJson,
      null
    ),
    entity: row.entity,
    isPinned: row.isPinned,
    isDefault: row.isDefault,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedViews(
  userId: string,
  page: string
): Promise<SavedViewDTO[]> {
  const rows = await db.savedView.findMany({
    where: { userId, page },
    orderBy: [
      { isPinned: "desc" },
      { order: "asc" },
      { createdAt: "desc" },
    ],
  });
  return rows.map(toSavedViewDTO);
}

export async function createSavedView(
  userId: string,
  input: z.infer<typeof savedViewInputSchema>
): Promise<SavedViewDTO> {
  const json = JSON.stringify(input.filters);
  // Upsert semantics: same (page, name) → replace the view state.
  const existing = await db.savedView.findFirst({
    where: { userId, page: input.page, name: input.name },
  });
  const data = {
    filtersJson: json,
    columnsJson:
      input.columns !== undefined && input.columns !== null
        ? JSON.stringify(input.columns)
        : undefined,
    sortJson:
      input.sort !== undefined && input.sort !== null
        ? JSON.stringify(input.sort)
        : undefined,
    groupingJson:
      input.grouping !== undefined && input.grouping !== null
        ? JSON.stringify(input.grouping)
        : undefined,
    isPinned: input.isPinned ?? undefined,
  };
  const row = existing
    ? await db.savedView.update({ where: { id: existing.id }, data })
    : await db.savedView.create({
        data: {
          userId,
          page: input.page,
          name: input.name,
          ...data,
          order: input.order ?? (await nextViewOrder(userId, input.page)),
        },
      });
  if (input.isDefault) {
    await unsetOtherDefaults(userId, input.page, row.id);
    return toSavedViewDTO(
      await db.savedView.update({
        where: { id: row.id },
        data: { isDefault: true },
      })
    );
  }
  return toSavedViewDTO(row);
}

async function nextViewOrder(userId: string, page: string): Promise<number> {
  const last = await db.savedView.findFirst({
    where: { userId, page },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return (last?.order ?? 0) + 10;
}

async function unsetOtherDefaults(
  userId: string,
  page: string,
  exceptId: string
): Promise<void> {
  await db.savedView.updateMany({
    where: { userId, page, id: { not: exceptId }, isDefault: true },
    data: { isDefault: false },
  });
}

export async function updateSavedView(
  userId: string,
  id: string,
  patch: {
    name?: string;
    filters?: Record<string, unknown>;
    columns?: string[] | null;
    sort?: Array<{ id: string; desc: boolean }> | null;
    grouping?: Record<string, unknown> | null;
    isPinned?: boolean;
    isDefault?: boolean;
    order?: number;
  }
): Promise<SavedViewDTO | null> {
  const existing = await db.savedView.findFirst({ where: { id, userId } });
  if (!existing) return null;
  if (patch.isDefault) {
    await unsetOtherDefaults(userId, existing.page, id);
  }
  const row = await db.savedView.update({
    where: { id },
    data: {
      name: patch.name ?? undefined,
      filtersJson:
        patch.filters !== undefined ? JSON.stringify(patch.filters) : undefined,
      columnsJson:
        patch.columns !== undefined
          ? patch.columns === null
            ? null
            : JSON.stringify(patch.columns)
          : undefined,
      sortJson:
        patch.sort !== undefined
          ? patch.sort === null
            ? null
            : JSON.stringify(patch.sort)
          : undefined,
      groupingJson:
        patch.grouping !== undefined
          ? patch.grouping === null
            ? null
            : JSON.stringify(patch.grouping)
          : undefined,
      isPinned: patch.isPinned ?? undefined,
      isDefault: patch.isDefault ?? undefined,
      order: patch.order ?? undefined,
    },
  });
  return toSavedViewDTO(row);
}

export async function duplicateSavedView(
  userId: string,
  id: string
): Promise<SavedViewDTO | null> {
  const existing = await db.savedView.findFirst({ where: { id, userId } });
  if (!existing) return null;
  let name = `${existing.name} (copie)`;
  let suffix = 2;
  while (
    await db.savedView.findFirst({
      where: { userId, page: existing.page, name },
      select: { id: true },
    })
  ) {
    name = `${existing.name} (copie ${suffix})`;
    suffix += 1;
  }
  const row = await db.savedView.create({
    data: {
      userId,
      page: existing.page,
      name,
      filtersJson: existing.filtersJson,
      columnsJson: existing.columnsJson,
      sortJson: existing.sortJson,
      groupingJson: existing.groupingJson,
      entity: existing.entity,
      isPinned: false,
      isDefault: false,
      order: await nextViewOrder(userId, existing.page),
    },
  });
  return toSavedViewDTO(row);
}

export async function deleteSavedView(userId: string, id: string): Promise<boolean> {
  const deleted = await db.savedView.deleteMany({ where: { id, userId } });
  return deleted.count > 0;
}
