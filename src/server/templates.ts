/**
 * Trade templates — server-side data access (v2 §4.1, userId-scoped).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { TemplateInput, TemplatePatch } from "@/lib/validations/trade";
import type { TemplateDTO } from "@/lib/trading/dto";

export class TemplateValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "TemplateValidationError";
    this.code = code;
    this.status = status;
  }
}

type TemplateRow = Prisma.TradeTemplateGetPayload<{
  include: { strategy: { select: { name: true } }, instrument: { select: { symbol: true } } };
}>;

function parseIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function toTemplateDTO(t: TemplateRow): TemplateDTO {
  return {
    id: t.id,
    name: t.name,
    strategyId: t.strategyId,
    strategyName: t.strategy?.name ?? null,
    instrumentId: t.instrumentId,
    symbol: t.instrument?.symbol ?? null,
    direction: t.direction,
    timeframe: t.timeframe,
    session: t.session,
    orderType: t.orderType,
    defaultRiskPercent: t.defaultRiskPercent?.toString() ?? null,
    defaultRiskAmount: t.defaultRiskAmount?.toString() ?? null,
    defaultLots: t.defaultLots?.toString() ?? null,
    defaultStopLossPips: t.defaultStopLossPips?.toString() ?? null,
    defaultTakeProfitPips: t.defaultTakeProfitPips?.toString() ?? null,
    defaultTagIds: parseIds(t.defaultTagIds),
    defaultChecklistItemIds: parseIds(t.defaultChecklistItemIds),
    prefilledNotes: t.prefilledNotes,
    usageCount: t.usageCount,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

const INCLUDE = {
  strategy: { select: { name: true } },
  instrument: { select: { symbol: true } },
} as const;

async function assertRelations(userId: string, input: {
  strategyId?: string | null;
  instrumentId?: string | null;
  defaultTagIds?: string[];
  defaultChecklistItemIds?: string[];
}) {
  if (input.strategyId) {
    const owned = await db.strategy.findFirst({
      where: { id: input.strategyId, userId },
      select: { id: true },
    });
    if (!owned) throw new TemplateValidationError("STRATEGY_NOT_FOUND");
  }
  if (input.instrumentId) {
    const ok = await db.instrument.findFirst({
      where: { id: input.instrumentId, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (!ok) throw new TemplateValidationError("INSTRUMENT_NOT_FOUND");
  }
  if (input.defaultTagIds && input.defaultTagIds.length > 0) {
    const rows = await db.tag.findMany({
      where: { id: { in: input.defaultTagIds }, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (rows.length !== input.defaultTagIds.length) {
      throw new TemplateValidationError("TAG_NOT_FOUND");
    }
  }
  if (input.defaultChecklistItemIds && input.defaultChecklistItemIds.length > 0) {
    const rows = await db.strategyChecklistItem.findMany({
      where: { id: { in: input.defaultChecklistItemIds }, strategy: { userId } },
      select: { id: true },
    });
    if (rows.length !== input.defaultChecklistItemIds.length) {
      throw new TemplateValidationError("CHECKLIST_NOT_FOUND");
    }
  }
}

export async function listTemplates(userId: string): Promise<TemplateDTO[]> {
  const rows = await db.tradeTemplate.findMany({
    where: { userId },
    include: INCLUDE,
    orderBy: [{ usageCount: "desc" }, { lastUsedAt: "desc" }, { name: "asc" }],
  });
  return rows.map(toTemplateDTO);
}

export async function createTemplate(
  userId: string,
  input: TemplateInput
): Promise<TemplateDTO> {
  await assertRelations(userId, input);
  const created = await db.tradeTemplate.create({
    data: {
      userId,
      name: input.name,
      strategyId: input.strategyId ?? null,
      instrumentId: input.instrumentId ?? null,
      direction: input.direction ?? null,
      timeframe: input.timeframe ?? null,
      session: input.session ?? null,
      orderType: input.orderType ?? null,
      defaultRiskPercent: input.defaultRiskPercent ?? null,
      defaultRiskAmount: input.defaultRiskAmount ?? null,
      defaultLots: input.defaultLots ?? null,
      defaultStopLossPips: input.defaultStopLossPips ?? null,
      defaultTakeProfitPips: input.defaultTakeProfitPips ?? null,
      defaultTagIds: JSON.stringify(input.defaultTagIds ?? []),
      defaultChecklistItemIds: JSON.stringify(input.defaultChecklistItemIds ?? []),
      prefilledNotes: input.prefilledNotes ?? null,
    },
    include: INCLUDE,
  });
  return toTemplateDTO(created);
}

export async function updateTemplate(
  userId: string,
  id: string,
  patch: TemplatePatch
): Promise<TemplateDTO | null> {
  const existing = await db.tradeTemplate.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await assertRelations(userId, patch);
  await db.tradeTemplate.update({
    where: { id: existing.id },
    data: {
      name: patch.name ?? undefined,
      strategyId: patch.strategyId !== undefined ? patch.strategyId : undefined,
      instrumentId: patch.instrumentId !== undefined ? patch.instrumentId : undefined,
      direction: patch.direction !== undefined ? patch.direction : undefined,
      timeframe: patch.timeframe !== undefined ? patch.timeframe : undefined,
      session: patch.session !== undefined ? patch.session : undefined,
      orderType: patch.orderType !== undefined ? patch.orderType : undefined,
      defaultRiskPercent:
        patch.defaultRiskPercent !== undefined ? patch.defaultRiskPercent : undefined,
      defaultRiskAmount:
        patch.defaultRiskAmount !== undefined ? patch.defaultRiskAmount : undefined,
      defaultLots: patch.defaultLots !== undefined ? patch.defaultLots : undefined,
      defaultStopLossPips:
        patch.defaultStopLossPips !== undefined ? patch.defaultStopLossPips : undefined,
      defaultTakeProfitPips:
        patch.defaultTakeProfitPips !== undefined ? patch.defaultTakeProfitPips : undefined,
      defaultTagIds:
        patch.defaultTagIds !== undefined
          ? JSON.stringify(patch.defaultTagIds)
          : undefined,
      defaultChecklistItemIds:
        patch.defaultChecklistItemIds !== undefined
          ? JSON.stringify(patch.defaultChecklistItemIds)
          : undefined,
      prefilledNotes:
        patch.prefilledNotes !== undefined ? patch.prefilledNotes : undefined,
    },
  });
  const row = await db.tradeTemplate.findFirst({ where: { id: existing.id }, include: INCLUDE });
  return row ? toTemplateDTO(row) : null;
}

/** Record a usage (applied to a form) - usage count + lastUsedAt. */
export async function recordTemplateUse(
  userId: string,
  id: string
): Promise<TemplateDTO | null> {
  const existing = await db.tradeTemplate.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await db.tradeTemplate.update({
    where: { id: existing.id },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  });
  const row = await db.tradeTemplate.findFirst({ where: { id: existing.id }, include: INCLUDE });
  return row ? toTemplateDTO(row) : null;
}

export async function deleteTemplate(userId: string, id: string): Promise<boolean> {
  const deleted = await db.tradeTemplate.deleteMany({ where: { id, userId } });
  return deleted.count > 0;
}
