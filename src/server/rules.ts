/**
 * Trading rules CRUD + violation detection (v1 phase 6).
 *
 * The detector rewrites the violations attached to a trade whenever that
 * trade is created / updated / closed (delete-then-insert → idempotent).
 * Rule edits trigger a BULK re-evaluation so history reflects the new
 * limits: one full pass over the user's non-draft trades (day aggregation
 * in JS, SQLite has no TZ support), then a single transaction rewrites
 * every violation row.
 *
 * Violation `note` carries a machine-readable JSON detail
 * { kind, measured, limit } — i18n happens at display time.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { localDateInTz } from "@/lib/analytics/calendar";
import {
  evaluateRules,
  type RuleDef,
  type RuleViolationResult,
} from "@/lib/trading/rules";
import type { RuleDTO, RuleViolationDTO } from "@/lib/trading/dto";
import type { RuleInput, RulePatch } from "@/lib/validations/goals";

type RuleRow = Prisma.TradingRuleGetPayload<Record<string, never>>;

function toRuleDTO(r: RuleRow): RuleDTO {
  return {
    id: r.id,
    kind: r.kind,
    value: r.value.toString(),
    description: r.description,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listRules(userId: string): Promise<RuleDTO[]> {
  const rows = await db.tradingRule.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toRuleDTO);
}

export async function createRule(
  userId: string,
  input: RuleInput
): Promise<RuleDTO> {
  const row = await db.tradingRule.create({
    data: {
      userId,
      kind: input.kind,
      value: input.value,
      description: input.description ?? null,
      isActive: input.isActive,
    },
  });
  // History follows the new limit.
  await reevaluateViolations(userId);
  return toRuleDTO(row);
}

export async function updateRule(
  userId: string,
  id: string,
  patch: RulePatch
): Promise<RuleDTO | null> {
  const existing = await db.tradingRule.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await db.tradingRule.update({
    where: { id },
    data: {
      ...(patch.kind != null ? { kind: patch.kind } : {}),
      ...(patch.value != null ? { value: patch.value } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description ?? null }
        : {}),
      ...(patch.isActive != null ? { isActive: patch.isActive } : {}),
    },
  });
  // Only detection-relevant changes need a re-evaluation.
  if (
    patch.kind != null ||
    patch.value != null ||
    patch.isActive != null
  ) {
    await reevaluateViolations(userId);
  }
  return toRuleDTO(row);
}

export async function deleteRule(userId: string, id: string): Promise<boolean> {
  const existing = await db.tradingRule.findFirst({ where: { id, userId } });
  if (!existing) return false;
  // Violations cascade-delete with the rule.
  await db.tradingRule.delete({ where: { id } });
  return true;
}

// ── Detection ───────────────────────────────────────────────────────────────

/** Fields needed to evaluate one trade. */
const EVAL_SELECT = {
  id: true,
  status: true,
  isDraft: true,
  entryTime: true,
  exitTime: true,
  riskAmount: true,
  netPnl: true,
} as const;

type EvalRow = Prisma.TradeGetPayload<{ select: typeof EVAL_SELECT }>;

/**
 * Re-evaluate ONE trade (after create/update/close). Best-effort: a
 * detection failure never fails the trade write itself.
 */
export async function evaluateTradeViolations(
  userId: string,
  tradeId: string
): Promise<void> {
  try {
    const [profile, trade] = await Promise.all([
      db.profile.findUnique({ where: { id: userId } }),
      db.trade.findFirst({ where: { id: tradeId, userId }, select: EVAL_SELECT }),
    ]);
    if (!trade) return;
    const timezone = profile?.timezone ?? "UTC";

    const [rules, entryDay, exitDay] = await Promise.all([
      db.tradingRule.findMany({ where: { userId, isActive: true } }),
      dayContext(userId, timezone, localDateInTz(trade.entryTime, timezone)),
      trade.exitTime
        ? dayContext(userId, timezone, localDateInTz(trade.exitTime, timezone))
        : Promise.resolve(null),
    ]);
    if (rules.length === 0) {
      await db.tradeRuleViolation.deleteMany({ where: { tradeId } });
      return;
    }

    const ruleDefs: RuleDef[] = rules.map((r) => ({
      id: r.id,
      kind: r.kind as RuleDef["kind"],
      value: r.value.toString(),
      description: r.description,
      isActive: r.isActive,
    }));

    const entryLocalDay = localDateInTz(trade.entryTime, timezone);
    const exitLocalDay = trade.exitTime
      ? localDateInTz(trade.exitTime, timezone)
      : null;
    if (entryLocalDay == null) return;

    const violations = evaluateRules(
      ruleDefs,
      {
        status: trade.status,
        isDraft: trade.isDraft,
        entryLocalDay,
        exitLocalDay,
        riskAmount: trade.riskAmount?.toString() ?? null,
        netPnl: trade.netPnl?.toString() ?? null,
      },
      {
        entryDayCount: entryDay.entryCount,
        exitDayPnl: exitDay?.exitPnl ?? [],
      }
    );

    await writeViolations(userId, tradeId, violations);
  } catch (error) {
    console.error("[rules] evaluateTradeViolations failed:", error);
  }
}

/** One local day's aggregates, margins included (SQLite has no TZ math). */
async function dayContext(
  userId: string,
  timezone: string,
  day: string | null
): Promise<{ entryCount: number; exitPnl: string[] }> {
  if (day == null) return { entryCount: 0, exitPnl: [] };
  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${day}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const [entries, exits] = await Promise.all([
    db.trade.findMany({
      where: {
        userId,
        isDraft: false,
        status: { in: ["OPEN", "CLOSED"] },
        entryTime: { gte: from, lt: to },
      },
      select: { entryTime: true },
    }),
    db.trade.findMany({
      where: {
        userId,
        isDraft: false,
        status: "CLOSED",
        exitTime: { gte: from, lt: to },
      },
      select: { exitTime: true, netPnl: true },
    }),
  ]);

  return {
    entryCount: entries.filter(
      (t) => localDateInTz(t.entryTime, timezone) === day
    ).length,
    exitPnl: exits
      .filter((t) => localDateInTz(t.exitTime!, timezone) === day)
      .map((t) => t.netPnl?.toString() ?? "0"),
  };
}

/** Rewrite the violations of one trade in a transaction. */
async function writeViolations(
  userId: string,
  tradeId: string,
  violations: RuleViolationResult[]
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.tradeRuleViolation.deleteMany({ where: { tradeId } });
    if (violations.length === 0) return;
    await tx.tradeRuleViolation.createMany({
      data: violations.map((v) => ({
        tradeId,
        ruleId: v.ruleId,
        note: JSON.stringify({
          kind: v.kind,
          measured: v.measured,
          limit: v.limit,
        }),
      })),
    });
  });
}

/**
 * BULK re-evaluation after rule edits: one pass over the user's non-draft
 * trades, day aggregates in JS, then a single transaction rewrites ALL
 * violation rows.
 */
export async function reevaluateViolations(userId: string): Promise<void> {
  const [profile, rules, trades] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.tradingRule.findMany({ where: { userId, isActive: true } }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: { in: ["OPEN", "CLOSED"] } },
      select: EVAL_SELECT,
    }),
  ]);
  const timezone = profile?.timezone ?? "UTC";

  const entryCountByDay = new Map<string, number>();
  const exitPnlByDay = new Map<string, string[]>();
  for (const t of trades) {
    const entryDay = localDateInTz(t.entryTime, timezone);
    if (entryDay != null) {
      entryCountByDay.set(entryDay, (entryCountByDay.get(entryDay) ?? 0) + 1);
    }
    if (t.status === "CLOSED" && t.exitTime != null) {
      const exitDay = localDateInTz(t.exitTime, timezone);
      if (exitDay != null) {
        const list = exitPnlByDay.get(exitDay) ?? [];
        list.push(t.netPnl?.toString() ?? "0");
        exitPnlByDay.set(exitDay, list);
      }
    }
  }

  const ruleDefs: RuleDef[] = rules.map((r) => ({
    id: r.id,
    kind: r.kind as RuleDef["kind"],
    value: r.value.toString(),
    description: r.description,
    isActive: r.isActive,
  }));

  const toWrite: Array<{ tradeId: string; ruleId: string; note: string }> = [];
  for (const t of trades) {
    const entryLocalDay = localDateInTz(t.entryTime, timezone);
    if (entryLocalDay == null) continue;
    const exitLocalDay =
      t.status === "CLOSED" && t.exitTime != null
        ? localDateInTz(t.exitTime, timezone)
        : null;
    const violations = evaluateRules(
      ruleDefs,
      {
        status: t.status,
        isDraft: t.isDraft,
        entryLocalDay,
        exitLocalDay,
        riskAmount: t.riskAmount?.toString() ?? null,
        netPnl: t.netPnl?.toString() ?? null,
      },
      {
        entryDayCount: entryCountByDay.get(entryLocalDay) ?? 0,
        exitDayPnl: exitLocalDay != null ? (exitPnlByDay.get(exitLocalDay) ?? []) : [],
      }
    );
    for (const v of violations) {
      toWrite.push({
        tradeId: t.id,
        ruleId: v.ruleId,
        note: JSON.stringify({
          kind: v.kind,
          measured: v.measured,
          limit: v.limit,
        }),
      });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.tradeRuleViolation.deleteMany({
      where: { trade: { userId } },
    });
    if (toWrite.length > 0) {
      await tx.tradeRuleViolation.createMany({ data: toWrite });
    }
  });
}

// ── Recent violations (widget + view) ───────────────────────────────────────

interface ViolationNote {
  kind: string;
  measured: string;
  limit: string;
}

function parseNote(note: string | null): ViolationNote | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note);
    if (parsed && typeof parsed === "object" && "kind" in parsed) {
      return parsed as ViolationNote;
    }
    return null;
  } catch {
    return null;
  }
}

export async function recentViolations(
  userId: string,
  days: number
): Promise<RuleViolationDTO[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const rows = await db.tradeRuleViolation.findMany({
    where: {
      trade: { userId },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      rule: { select: { kind: true, description: true } },
      trade: {
        select: {
          instrument: { select: { symbol: true } },
          direction: true,
          entryTime: true,
          exitTime: true,
          netPnl: true,
          isDraft: true,
        },
      },
    },
  });

  return rows.map((r) => {
    const note = parseNote(r.note);
    return {
      tradeId: r.tradeId,
      ruleId: r.ruleId,
      kind: note?.kind ?? r.rule.kind,
      measured: note?.measured ?? "",
      limit: note?.limit ?? "",
      description: r.rule.description,
      createdAt: r.createdAt.toISOString(),
      trade: {
        symbol: r.trade.instrument.symbol,
        direction: r.trade.direction,
        entryTime: r.trade.entryTime.toISOString(),
        exitTime: r.trade.exitTime?.toISOString() ?? null,
        netPnl: r.trade.netPnl?.toString() ?? null,
        isDraft: r.trade.isDraft,
      },
    };
  });
}

/** Violations attached to one trade (trade detail view). */
export async function tradeViolations(
  userId: string,
  tradeId: string
): Promise<RuleViolationDTO[]> {
  const owned = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true },
  });
  if (!owned) return [];
  const rows = await db.tradeRuleViolation.findMany({
    where: { tradeId },
    orderBy: { createdAt: "desc" },
    include: {
      rule: { select: { kind: true, description: true } },
      trade: {
        select: {
          instrument: { select: { symbol: true } },
          direction: true,
          entryTime: true,
          exitTime: true,
          netPnl: true,
          isDraft: true,
        },
      },
    },
  });
  return rows.map((r) => {
    const note = parseNote(r.note);
    return {
      tradeId: r.tradeId,
      ruleId: r.ruleId,
      kind: note?.kind ?? r.rule.kind,
      measured: note?.measured ?? "",
      limit: note?.limit ?? "",
      description: r.rule.description,
      createdAt: r.createdAt.toISOString(),
      trade: {
        symbol: r.trade.instrument.symbol,
        direction: r.trade.direction,
        entryTime: r.trade.entryTime.toISOString(),
        exitTime: r.trade.exitTime?.toISOString() ?? null,
        netPnl: r.trade.netPnl?.toString() ?? null,
        isDraft: r.trade.isDraft,
      },
    };
  });
}
