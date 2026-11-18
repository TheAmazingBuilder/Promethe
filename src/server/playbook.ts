/**
 * Playbook server (Phase 2) — setups, playbook rules, checklist templates,
 * overview, setup insights, duplication, template instantiation and the
 * review-time playbook match.
 *
 * Ownership is enforced on every query (userId). Strategies are read through
 * the same user scope; archived strategies stay visible here (unlike the
 * trade-form selector list, which hides them).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  ChecklistTemplateDTO,
  PlaybookOverviewDTO,
  PlaybookRuleDTO,
  SetupDTO,
  SetupInsightDTO,
  StrategyDTO,
  StrategyStatsDTO,
} from "@/lib/trading/dto";
import { toStrategyDTO } from "@/server/reference";
import { strategyStats } from "@/server/strategies";
import {
  complianceSummary,
  cumulativeR,
  setupInsight as computeSetupInsight,
  strategyHealthFlags,
} from "@/lib/playbook/health";
import {
  EXAMPLE_RULES,
  findStrategyTemplate,
  GLOBAL_CHECKLIST,
  STRATEGY_TEMPLATES,
  type PlaybookStrategyTemplate,
} from "@/lib/playbook/templates";
import type {
  ChecklistTemplateInput,
  PlaybookRuleInput,
  SetupInput,
} from "@/lib/validations/playbook";

// ── JSON helpers ─────────────────────────────────────────────────────────────

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

type TemplateItem = { label: string; required: boolean; category: string };

function parseTemplateItems(json: string): TemplateItem[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is Record<string, unknown> =>
          !!v && typeof v === "object",
      )
      .map((v) => ({
        label: typeof v.label === "string" ? v.label : "",
        required: v.required === true,
        category:
          typeof v.category === "string" ? v.category : "ENTRY",
      }))
      .filter((i) => i.label.length > 0);
  } catch {
    return [];
  }
}

// ── DTO mappers ──────────────────────────────────────────────────────────────

type SetupRow = Prisma.SetupGetPayload<{
  include: { strategy: { select: { name: true } }; _count: { select: { trades: true } } };
}>;

function toSetupDTO(s: SetupRow): SetupDTO {
  return {
    id: s.id,
    strategyId: s.strategyId,
    strategyName: s.strategy?.name ?? null,
    name: s.name,
    description: s.description,
    status: s.status,
    context: s.context,
    marketCondition: s.marketCondition,
    trigger: s.trigger,
    confirmation: s.confirmation,
    entryModel: s.entryModel,
    stopModel: s.stopModel,
    targetModel: s.targetModel,
    invalidation: s.invalidation,
    notes: s.notes,
    tags: parseStringArray(s.tagsJson),
    tradeCount: s._count.trades,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

type PlaybookRuleRow = Prisma.PlaybookRuleGetPayload<{
  include: { strategy: { select: { name: true } } };
}>;

function toPlaybookRuleDTO(r: PlaybookRuleRow): PlaybookRuleDTO {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    category: r.category,
    scope: r.scope,
    strategyId: r.strategyId,
    strategyName: r.strategy?.name ?? null,
    evaluatable: r.evaluatable,
    evaluationHint: r.evaluationHint,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type ChecklistTemplateRow = Prisma.ChecklistTemplateGetPayload<{
  include: { strategy: { select: { name: true } } };
}>;

function toChecklistTemplateDTO(t: ChecklistTemplateRow): ChecklistTemplateDTO {
  return {
    id: t.id,
    strategyId: t.strategyId,
    strategyName: t.strategy?.name ?? null,
    name: t.name,
    items: parseTemplateItems(t.itemsJson),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const SETUP_INCLUDE = {
  strategy: { select: { name: true } },
  _count: { select: { trades: true } },
} as const;

const RULE_INCLUDE = { strategy: { select: { name: true } } } as const;
const TEMPLATE_INCLUDE = { strategy: { select: { name: true } } } as const;

async function ownStrategy(
  userId: string,
  strategyId: string | null | undefined,
) {
  if (!strategyId) return null;
  const strategy = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  return strategy;
}

// ── Setups ───────────────────────────────────────────────────────────────────

export async function listSetups(
  userId: string,
  strategyId?: string | null,
): Promise<SetupDTO[]> {
  const rows = await db.setup.findMany({
    where: {
      userId,
      ...(strategyId ? { strategyId } : {}),
    },
    include: SETUP_INCLUDE,
    orderBy: [{ strategyId: "asc" }, { name: "asc" }],
  });
  return rows.map(toSetupDTO);
}

export async function createSetup(
  userId: string,
  input: SetupInput,
): Promise<SetupDTO | null> {
  const strategy = await ownStrategy(userId, input.strategyId);
  if (!strategy) return null;
  const created = await db.setup.create({
    data: {
      userId,
      strategyId: input.strategyId,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      context: input.context ?? null,
      marketCondition: input.marketCondition ?? null,
      trigger: input.trigger ?? null,
      confirmation: input.confirmation ?? null,
      entryModel: input.entryModel ?? null,
      stopModel: input.stopModel ?? null,
      targetModel: input.targetModel ?? null,
      invalidation: input.invalidation,
      notes: input.notes ?? null,
      tagsJson: JSON.stringify(input.tags ?? []),
    },
    include: SETUP_INCLUDE,
  });
  return toSetupDTO(created);
}

export async function updateSetup(
  userId: string,
  id: string,
  patch: Partial<SetupInput>,
): Promise<SetupDTO | null> {
  const existing = await db.setup.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const updated = await db.setup.update({
    where: { id: existing.id },
    data: {
      name: patch.name ?? undefined,
      description: patch.description !== undefined ? patch.description : undefined,
      status: patch.status ?? undefined,
      context: patch.context !== undefined ? patch.context : undefined,
      marketCondition:
        patch.marketCondition !== undefined ? patch.marketCondition : undefined,
      trigger: patch.trigger !== undefined ? patch.trigger : undefined,
      confirmation:
        patch.confirmation !== undefined ? patch.confirmation : undefined,
      entryModel: patch.entryModel !== undefined ? patch.entryModel : undefined,
      stopModel: patch.stopModel !== undefined ? patch.stopModel : undefined,
      targetModel:
        patch.targetModel !== undefined ? patch.targetModel : undefined,
      invalidation: patch.invalidation ?? undefined,
      notes: patch.notes !== undefined ? patch.notes : undefined,
      tagsJson: patch.tags !== undefined ? JSON.stringify(patch.tags) : undefined,
    },
    include: SETUP_INCLUDE,
  });
  return toSetupDTO(updated);
}

/** Deletes a setup. Trades keep their history — their setupId is SetNull. */
export async function deleteSetup(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db.setup.deleteMany({ where: { id, userId } });
  return deleted.count > 0;
}

// ── Playbook rules ───────────────────────────────────────────────────────────

export async function listPlaybookRules(
  userId: string,
): Promise<PlaybookRuleDTO[]> {
  const rows = await db.playbookRule.findMany({
    where: { userId },
    include: RULE_INCLUDE,
    orderBy: [{ scope: "asc" }, { category: "asc" }, { title: "asc" }],
  });
  return rows.map(toPlaybookRuleDTO);
}

export async function createPlaybookRule(
  userId: string,
  input: PlaybookRuleInput,
): Promise<PlaybookRuleDTO | null> {
  if (input.scope === "STRATEGY") {
    const strategy = await ownStrategy(userId, input.strategyId);
    if (!strategy) return null;
  }
  const created = await db.playbookRule.create({
    data: {
      userId,
      title: input.title,
      detail: input.detail ?? "",
      category: input.category,
      scope: input.scope,
      strategyId:
        input.scope === "STRATEGY" ? (input.strategyId ?? null) : null,
      evaluatable: input.evaluatable ?? false,
      evaluationHint: input.evaluationHint ?? null,
      active: input.active ?? true,
    },
    include: RULE_INCLUDE,
  });
  return toPlaybookRuleDTO(created);
}

export async function updatePlaybookRule(
  userId: string,
  id: string,
  patch: Partial<PlaybookRuleInput>,
): Promise<PlaybookRuleDTO | null> {
  const existing = await db.playbookRule.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const scope = patch.scope ?? existing.scope;
  const strategyId =
    patch.strategyId !== undefined ? patch.strategyId : existing.strategyId;
  if (scope === "STRATEGY") {
    const strategy = await ownStrategy(userId, strategyId);
    if (!strategy) return null;
  }
  const updated = await db.playbookRule.update({
    where: { id: existing.id },
    data: {
      title: patch.title ?? undefined,
      detail: patch.detail ?? undefined,
      category: patch.category ?? undefined,
      scope: patch.scope ?? undefined,
      strategyId: scope === "STRATEGY" ? strategyId : null,
      evaluatable: patch.evaluatable ?? undefined,
      evaluationHint:
        patch.evaluationHint !== undefined ? patch.evaluationHint : undefined,
      active: patch.active ?? undefined,
    },
    include: RULE_INCLUDE,
  });
  return toPlaybookRuleDTO(updated);
}

export async function deletePlaybookRule(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db.playbookRule.deleteMany({ where: { id, userId } });
  return deleted.count > 0;
}

// ── Checklist templates ──────────────────────────────────────────────────────

export async function listChecklistTemplates(
  userId: string,
): Promise<ChecklistTemplateDTO[]> {
  const rows = await db.checklistTemplate.findMany({
    where: { userId },
    include: TEMPLATE_INCLUDE,
    orderBy: [{ strategyId: "asc" }, { name: "asc" }],
  });
  return rows.map(toChecklistTemplateDTO);
}

export async function createChecklistTemplate(
  userId: string,
  input: ChecklistTemplateInput,
): Promise<ChecklistTemplateDTO | null> {
  if (input.strategyId) {
    const strategy = await ownStrategy(userId, input.strategyId);
    if (!strategy) return null;
  }
  const created = await db.checklistTemplate.create({
    data: {
      userId,
      strategyId: input.strategyId ?? null,
      name: input.name,
      itemsJson: JSON.stringify(input.items),
    },
    include: TEMPLATE_INCLUDE,
  });
  return toChecklistTemplateDTO(created);
}

export async function updateChecklistTemplate(
  userId: string,
  id: string,
  patch: Partial<ChecklistTemplateInput>,
): Promise<ChecklistTemplateDTO | null> {
  const existing = await db.checklistTemplate.findFirst({
    where: { id, userId },
  });
  if (!existing) return null;
  if (patch.strategyId) {
    const strategy = await ownStrategy(userId, patch.strategyId);
    if (!strategy) return null;
  }
  const updated = await db.checklistTemplate.update({
    where: { id: existing.id },
    data: {
      strategyId:
        patch.strategyId !== undefined ? patch.strategyId : undefined,
      name: patch.name ?? undefined,
      itemsJson:
        patch.items !== undefined ? JSON.stringify(patch.items) : undefined,
    },
    include: TEMPLATE_INCLUDE,
  });
  return toChecklistTemplateDTO(updated);
}

export async function deleteChecklistTemplate(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db.checklistTemplate.deleteMany({
    where: { id, userId },
  });
  return deleted.count > 0;
}

// ── Strategies (Playbook list: every status, with setups) ───────────────────

export async function listPlaybookStrategies(
  userId: string,
): Promise<StrategyDTO[]> {
  const rows = await db.strategy.findMany({
    where: { userId },
    include: {
      checklistItems: { orderBy: { order: "asc" } },
      setups: {
        include: {
          strategy: { select: { name: true } },
          _count: { select: { trades: true } },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const tradeCounts = await db.trade.groupBy({
    by: ["strategyId"],
    where: { userId, strategyId: { not: null } },
    _count: { id: true },
  });
  const counts = new Map(
    tradeCounts.map((c) => [c.strategyId as string, c._count.id]),
  );
  return rows.map((s) => ({
    ...toStrategyDTO(s),
    setups: s.setups.map(toSetupDTO),
    tradeCount: counts.get(s.id) ?? 0,
  }));
}

// ── Extended strategy stats (sparkline + expectancy last 20) ───────────────

export async function strategyStatsExtended(
  userId: string,
): Promise<StrategyStatsDTO[]> {
  const [base, trades] = await Promise.all([
    strategyStats(userId),
    db.trade.findMany({
      where: { userId, status: "CLOSED", isDraft: false, strategyId: { not: null } },
      select: {
        strategyId: true,
        exitTime: true,
        entryTime: true,
        rMultiple: true,
      },
      orderBy: { exitTime: "asc" },
    }),
  ]);

  const byStrategy = new Map<
    string,
    Array<{ r: number; at: Date }>
  >();
  for (const t of trades) {
    if (t.strategyId == null || t.rMultiple == null) continue;
    const list = byStrategy.get(t.strategyId) ?? [];
    list.push({
      r: Number(t.rMultiple),
      at: t.exitTime ?? t.entryTime,
    });
    byStrategy.set(t.strategyId, list);
  }

  // Worst strategy by expectancy over the last 20 closed trades.
  let worstKey: string | null = null;
  let worstExpectancy = 0;
  const enriched = base.map((s) => {
    const rs = (byStrategy.get(s.key) ?? []).sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    const last20 = rs.slice(-20);
    const expectancyR20 =
      last20.length === 0
        ? null
        : (
            last20.reduce((sum, p) => sum + p.r, 0) / last20.length
          ).toFixed(4);
    if (
      expectancyR20 !== null &&
      last20.length >= 5 &&
      Number(expectancyR20) < 0 &&
      (worstKey === null || Number(expectancyR20) < worstExpectancy)
    ) {
      worstKey = s.key;
      worstExpectancy = Number(expectancyR20);
    }
    return {
      ...s,
      sparklineR: cumulativeR(rs),
      expectancyR20,
      trades20: last20.length,
      underperforming: false,
    };
  });
  if (worstKey) {
    for (const s of enriched) {
      if (s.key === worstKey) s.underperforming = true;
    }
  }
  return enriched;
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function playbookOverview(
  userId: string,
): Promise<PlaybookOverviewDTO> {
  const [strategies, setups, rules, checklists, closedTrades, stats] =
    await Promise.all([
      db.strategy.findMany({
        where: { userId },
        include: {
          checklistItems: { select: { id: true } },
          setups: { select: { id: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      db.setup.count({ where: { userId } }),
      db.playbookRule.count({ where: { userId } }),
      db.checklistTemplate.count({ where: { userId } }),
      db.trade.findMany({
        where: { userId, status: "CLOSED", isDraft: false },
        select: {
          id: true,
          strategyId: true,
          exitTime: true,
          entryTime: true,
          review: { select: { playbookMatch: true } },
        },
        orderBy: { exitTime: "desc" },
        take: 20,
      }),
      strategyStatsExtended(userId),
    ]);

  const counts = {
    totalStrategies: strategies.length,
    active: strategies.filter((s) => s.status === "ACTIVE").length,
    draft: strategies.filter((s) => s.status === "DRAFT").length,
    paused: strategies.filter((s) => s.status === "PAUSED").length,
    archived: strategies.filter((s) => s.status === "ARCHIVED").length,
    testing: strategies.filter((s) => s.status === "TESTING").length,
    totalSetups: setups,
    totalRules: rules,
    totalChecklists: checklists,
  };

  const lastTradeAt = new Map<string, Date>();
  const tradeCount = new Map<string, number>();
  // Last-trade dates and counts come from all closed trades (the 20-trade
  // window above is only for compliance).
  const older = await db.trade.findMany({
    where: { userId, status: "CLOSED", isDraft: false, strategyId: { not: null } },
    select: { strategyId: true, exitTime: true, entryTime: true },
    orderBy: { exitTime: "desc" },
  });
  for (const t of older) {
    if (!t.strategyId) continue;
    const at = t.exitTime ?? t.entryTime;
    const cur = lastTradeAt.get(t.strategyId);
    if (!cur || at > cur) lastTradeAt.set(t.strategyId, at);
    tradeCount.set(t.strategyId, (tradeCount.get(t.strategyId) ?? 0) + 1);
  }

  const hasRisk = (s: (typeof strategies)[number]): boolean => {
    if (s.defaultRiskPercent != null) return true;
    if (s.riskRules && s.riskRules.trim().length > 0) return true;
    try {
      const risk = JSON.parse(s.riskJson ?? "null") as Record<string, unknown> | null;
      if (!risk) return false;
      return (
        risk.defaultRiskPct != null ||
        risk.maxRiskPct != null ||
        (typeof risk.stopMethodology === "string" &&
          risk.stopMethodology.trim().length > 0)
      );
    } catch {
      return false;
    }
  };
  const hasEntry = (s: (typeof strategies)[number]): boolean => {
    if (s.entryRules && s.entryRules.trim().length > 0) return true;
    try {
      const arr = JSON.parse(s.entryConditionsJson ?? "[]") as unknown[];
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  };
  const hasInvalidation = (s: (typeof strategies)[number]): boolean => {
    if (s.setups.length > 0) return true;
    try {
      const arr = JSON.parse(s.invalidationsJson ?? "[]") as unknown[];
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  };

  const health = strategies.map((s) => ({
    strategyId: s.id,
    flags: strategyHealthFlags({
      status: s.status,
      hasRisk: hasRisk(s),
      hasEntryConditions: hasEntry(s),
      hasInvalidation: hasInvalidation(s),
      hasChecklist: s.checklistItems.length > 0,
      lastTradeAt: lastTradeAt.get(s.id) ?? null,
    }),
  }));

  const compliance = complianceSummary(
    closedTrades.map((t) => ({ playbookMatch: t.review?.playbookMatch ?? null })),
  );

  const underperformingRow = stats.find((s) => s.underperforming) ?? null;

  return {
    counts,
    recentlyUpdated: strategies.slice(0, 5).map((s) => ({
      strategyId: s.id,
      name: s.name,
      status: s.status,
      color: s.color,
      version: s.version,
      updatedAt: s.updatedAt.toISOString(),
    })),
    recentlyUsed: [...tradeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([strategyId, n]) => {
        const s = strategies.find((x) => x.id === strategyId);
        return {
          strategyId,
          name: s?.name ?? "—",
          color: s?.color ?? "#10b981",
          lastTradeAt: lastTradeAt.get(strategyId)?.toISOString() ?? null,
          tradesCount: n,
        };
      }),
    compliance: { windowSize: 20, ...compliance },
    health,
    underperforming:
      underperformingRow && underperformingRow.expectancyR20 !== null
        ? {
            strategyId: underperformingRow.key,
            name: underperformingRow.name,
            expectancyR20: underperformingRow.expectancyR20,
            trades20: underperformingRow.trades20,
          }
        : null,
  };
}

// ── Setup insights (90-day window) ───────────────────────────────────────────

export async function setupInsights(
  userId: string,
  strategyId?: string | null,
): Promise<SetupInsightDTO[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const setups = await db.setup.findMany({
    where: { userId, ...(strategyId ? { strategyId } : {}) },
    orderBy: { name: "asc" },
  });
  const trades = await db.trade.findMany({
    where: {
      userId,
      status: "CLOSED",
      isDraft: false,
      setupId: { not: null },
      entryTime: { gte: since },
    },
    select: {
      setupId: true,
      resultType: true,
      rMultiple: true,
      instrumentId: true,
      session: true,
      instrument: { select: { symbol: true } },
    },
  });
  const bySetup = new Map<string, typeof trades>();
  for (const t of trades) {
    if (!t.setupId) continue;
    const list = bySetup.get(t.setupId) ?? [];
    list.push(t);
    bySetup.set(t.setupId, list);
  }
  return setups.map((s) => {
    const rows = (bySetup.get(s.id) ?? []).map((t) => ({
      resultType: t.resultType,
      rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
      instrumentId: t.instrumentId,
      symbol: t.instrument.symbol,
      session: t.session,
    }));
    return {
      setupId: s.id,
      strategyId: s.strategyId,
      setupName: s.name,
      windowDays: 90 as const,
      ...computeSetupInsight(rows),
    };
  });
}

// ── Duplicate ────────────────────────────────────────────────────────────────

export async function duplicateStrategy(
  userId: string,
  strategyId: string,
  name?: string | null,
): Promise<StrategyDTO | null> {
  const source = await db.strategy.findFirst({
    where: { id: strategyId, userId },
    include: {
      checklistItems: { orderBy: { order: "asc" } },
      setups: true,
    },
  });
  if (!source) return null;

  const newName = (name?.trim() || `${source.name} (copy)`).slice(0, 80);
  const created = await db.strategy.create({
    data: {
      userId,
      name: newName,
      description: source.description,
      color: source.color,
      status: "DRAFT",
      version: 1,
      grade: null,
      timeframesJson: source.timeframesJson,
      instrumentsJson: source.instrumentsJson,
      sessionsJson: source.sessionsJson,
      entryRules: source.entryRules,
      exitRules: source.exitRules,
      riskRules: source.riskRules,
      defaultRiskPercent: source.defaultRiskPercent,
      targetRR: source.targetRR,
      detailedDescription: source.detailedDescription,
      tagsJson: source.tagsJson,
      marketProfileJson: source.marketProfileJson,
      marketConditionsJson: source.marketConditionsJson,
      entryConditionsJson: source.entryConditionsJson,
      confirmationsJson: source.confirmationsJson,
      invalidationsJson: source.invalidationsJson,
      riskJson: source.riskJson,
      tradeManagementJson: source.tradeManagementJson,
      exitPlanJson: source.exitPlanJson,
      checklistItems: {
        create: source.checklistItems.map((c) => ({
          label: c.label,
          category: c.category,
          order: c.order,
          isRequired: c.isRequired,
        })),
      },
      setups: {
        create: source.setups.map((s) => ({
          userId,
          name: s.name,
          description: s.description,
          status: "DRAFT",
          context: s.context,
          marketCondition: s.marketCondition,
          trigger: s.trigger,
          confirmation: s.confirmation,
          entryModel: s.entryModel,
          stopModel: s.stopModel,
          targetModel: s.targetModel,
          invalidation: s.invalidation,
          notes: s.notes,
          tagsJson: s.tagsJson,
        })),
      },
    },
    include: {
      checklistItems: { orderBy: { order: "asc" } },
      setups: {
        include: {
          strategy: { select: { name: true } },
          _count: { select: { trades: true } },
        },
      },
    },
  });
  return {
    ...toStrategyDTO(created),
    setups: created.setups.map(toSetupDTO),
    tradeCount: 0,
  };
}

// ── Templates (code-only content) ────────────────────────────────────────────

export function listPlaybookTemplates(): PlaybookStrategyTemplate[] {
  return STRATEGY_TEMPLATES;
}

export async function instantiateTemplate(
  userId: string,
  key: string,
  name?: string | null,
): Promise<StrategyDTO | null> {
  const tpl = findStrategyTemplate(key);
  if (!tpl) return null;
  const created = await db.strategy.create({
    data: {
      userId,
      name: (name?.trim() || tpl.name).slice(0, 80),
      description: tpl.description,
      color: "#10b981",
      status: "DRAFT",
      version: 1,
      grade: null,
      timeframesJson: JSON.stringify(tpl.timeframes),
      instrumentsJson: JSON.stringify(["XAUUSD"]),
      sessionsJson: JSON.stringify(tpl.sessions),
      entryRules: tpl.entryRules,
      exitRules: tpl.exitRules,
      riskRules: tpl.riskRules,
      defaultRiskPercent: tpl.defaultRiskPercent,
      targetRR: tpl.targetRR,
      detailedDescription: tpl.detailedDescription,
      tagsJson: JSON.stringify(tpl.tags),
      marketConditionsJson: JSON.stringify(tpl.marketConditions),
      setups: {
        create: tpl.setups.map((s) => ({
          userId,
          name: s.name,
          status: "DRAFT",
          context: s.context,
          trigger: s.trigger,
          confirmation: s.confirmation,
          entryModel: s.entryModel,
          stopModel: s.stopModel,
          targetModel: s.targetModel,
          invalidation: s.invalidation,
        })),
      },
    },
    include: {
      checklistItems: { orderBy: { order: "asc" } },
      setups: {
        include: {
          strategy: { select: { name: true } },
          _count: { select: { trades: true } },
        },
      },
    },
  });
  return {
    ...toStrategyDTO(created),
    setups: created.setups.map(toSetupDTO),
    tradeCount: 0,
  };
}

/** Adds the universal pre-trade checklist as a global template (idempotent by name). */
export async function installGlobalChecklist(
  userId: string,
): Promise<ChecklistTemplateDTO> {
  const existing = await db.checklistTemplate.findFirst({
    where: { userId, strategyId: null, name: GLOBAL_CHECKLIST.name },
    include: TEMPLATE_INCLUDE,
  });
  if (existing) return toChecklistTemplateDTO(existing);
  const created = await db.checklistTemplate.create({
    data: {
      userId,
      strategyId: null,
      name: GLOBAL_CHECKLIST.name,
      itemsJson: JSON.stringify(GLOBAL_CHECKLIST.items),
    },
    include: TEMPLATE_INCLUDE,
  });
  return toChecklistTemplateDTO(created);
}

/** Adds the 6 example rules (idempotent by title). Returns how many were added. */
export async function installExampleRules(userId: string): Promise<number> {
  const existing = await db.playbookRule.findMany({
    where: { userId, title: { in: EXAMPLE_RULES.map((r) => r.title) } },
    select: { title: true },
  });
  const have = new Set(existing.map((r) => r.title));
  const missing = EXAMPLE_RULES.filter((r) => !have.has(r.title));
  if (missing.length === 0) return 0;
  await db.playbookRule.createMany({
    data: missing.map((r) => ({
      userId,
      title: r.title,
      detail: r.detail,
      category: r.category,
      scope: r.scope,
      strategyId: null,
      evaluatable: r.evaluatable,
      evaluationHint: r.evaluationHint,
      active: true,
    })),
  });
  return missing.length;
}

// ── Review: playbook match ───────────────────────────────────────────────────

export async function setPlaybookMatch(
  userId: string,
  tradeId: string,
  match: "MATCHED" | "PARTIAL" | "OFF_PLAYBOOK",
): Promise<string | null> {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true },
  });
  if (!trade) return null;
  const existing = await db.tradeReview.findFirst({
    where: { tradeId: trade.id },
  });
  if (existing) {
    await db.tradeReview.update({
      where: { id: existing.id },
      data: { playbookMatch: match },
    });
  } else {
    // A review may exist only to declare the match: scored fields stay
    // null rather than inventing scores the user never gave.
    await db.tradeReview.create({
      data: {
        tradeId: trade.id,
        userId,
        playbookMatch: match,
        followedPlan: null,
        planAdherenceScore: null,
        executionQuality: null,
        entryQuality: null,
        exitQuality: null,
        riskManagementScore: null,
        emotionalControlScore: null,
        wouldTakeAgain: null,
      },
    });
  }
  return match;
}

export async function getPlaybookMatch(
  userId: string,
  tradeId: string,
): Promise<string | null> {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true },
  });
  if (!trade) return null;
  const review = await db.tradeReview.findFirst({
    where: { tradeId: trade.id },
    select: { playbookMatch: true },
  });
  return review?.playbookMatch ?? null;
}
