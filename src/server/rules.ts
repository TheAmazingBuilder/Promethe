/**
 * Trading rules CRUD + violation detection (v1 phase 6).
 *
 * The detector rewrites the violations attached to a trade whenever that
 * trade is created / updated / closed (delete-then-insert → idempotent).
 * Rule edits trigger a BULK re-evaluation so history reflects the new
 * limits: one full pass over the user's non-draft trades (day aggregation
 * in JS, SQLite has no TZ support), then a single transaction rewrites
 * every violation row. A violation that survives a re-evaluation keeps
 * its first-seen date (Lot 11) - only the measured limit follows the
 * current rule; the date a breach first appeared is history, not
 * something a rule edit should rewrite.
 *
 * Violation `note` carries a machine-readable JSON detail
 * { kind, measured, limit } — i18n happens at display time.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay } from "@/lib/time/trading-day";
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
  plannedRR: true,
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
    const [profile, prefs, trade] = await Promise.all([
      db.profile.findUnique({ where: { id: userId } }),
      getDisplayPreferences(userId),
      db.trade.findFirst({ where: { id: tradeId, userId }, select: EVAL_SELECT }),
    ]);
    if (!trade) return;
    const timezone = profile?.timezone ?? "UTC";
    // Daily rules (MAX_TRADES_PER_DAY, MAX_DAILY_LOSS) are evaluated on the
    // user's TRADING day, not the civil day — default MIDNIGHT_LOCAL keeps
    // the previous behaviour exactly.
    const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);

    const [rules, entryDay, exitDay] = await Promise.all([
      db.tradingRule.findMany({ where: { userId, isActive: true } }),
      dayContext(userId, dayOf(trade.entryTime), dayOf),
      trade.exitTime
        ? dayContext(userId, dayOf(trade.exitTime), dayOf)
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

    const entryLocalDay = dayOf(trade.entryTime);
    const exitLocalDay = trade.exitTime ? dayOf(trade.exitTime) : null;

    const violations = evaluateRules(
      ruleDefs,
      {
        status: trade.status,
        isDraft: trade.isDraft,
        entryLocalDay,
        exitLocalDay,
        riskAmount: trade.riskAmount?.toString() ?? null,
        plannedRR: trade.plannedRR?.toString() ?? null,
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

/** One trading day's aggregates, margins included (SQLite has no TZ math).
 * The ±1 day margin covers TZ offsets and rollovers (a NY-close trading day
 * spans 17:00 NY the previous day to 17:00 NY the same day). */
async function dayContext(
  userId: string,
  day: string | null,
  dayOf: (d: Date) => string
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
    entryCount: entries.filter((t) => dayOf(t.entryTime) === day).length,
    exitPnl: exits
      .filter((t) => dayOf(t.exitTime!) === day)
      .map((t) => t.netPnl?.toString() ?? "0"),
  };
}

/**
 * Rewrite the violations of one trade in a transaction.
 *
 * Lot 11 (roadmap §14): a violation that survives re-evaluation keeps
 * its FIRST-SEEN date. Bulk re-evaluation used to delete and recreate
 * every row, so an old violation looked "recent" again after any rule
 * edit and the "recent violations" widget lied about its age. The
 * measured limit in `note` is still the current one (history follows
 * the current limits by design); only the first-seen date is preserved.
 */
async function writeViolations(
  userId: string,
  tradeId: string,
  violations: RuleViolationResult[]
): Promise<void> {
  const existing = await db.tradeRuleViolation.findMany({
    where: { tradeId },
    select: { ruleId: true, createdAt: true },
  });
  const firstSeen = new Map(existing.map((r) => [r.ruleId, r.createdAt]));
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
        createdAt: firstSeen.get(v.ruleId) ?? new Date(),
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
  const [profile, prefs, rules, trades] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    getDisplayPreferences(userId),
    db.tradingRule.findMany({ where: { userId, isActive: true } }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: { in: ["OPEN", "CLOSED"] } },
      select: EVAL_SELECT,
    }),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  // Trading-day buckets (default MIDNIGHT_LOCAL = previous behaviour).
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);

  const entryCountByDay = new Map<string, number>();
  const exitPnlByDay = new Map<string, string[]>();
  for (const t of trades) {
    const entryDay = dayOf(t.entryTime);
    entryCountByDay.set(entryDay, (entryCountByDay.get(entryDay) ?? 0) + 1);
    if (t.status === "CLOSED" && t.exitTime != null) {
      const exitDay = dayOf(t.exitTime);
      const list = exitPnlByDay.get(exitDay) ?? [];
      list.push(t.netPnl?.toString() ?? "0");
      exitPnlByDay.set(exitDay, list);
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
    const entryLocalDay = dayOf(t.entryTime);
    const exitLocalDay =
      t.status === "CLOSED" && t.exitTime != null ? dayOf(t.exitTime) : null;
    const violations = evaluateRules(
      ruleDefs,
      {
        status: t.status,
        isDraft: t.isDraft,
        entryLocalDay,
        exitLocalDay,
        riskAmount: t.riskAmount?.toString() ?? null,
        plannedRR: t.plannedRR?.toString() ?? null,
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
    // Lot 11 (roadmap §14): keep the first-seen date of violations that
    // survive the re-evaluation (see writeViolations). A violation that
    // disappears and later reappears gets a fresh date - it is a new
    // breach, not the old one.
    const existing = await tx.tradeRuleViolation.findMany({
      where: { trade: { userId } },
      select: { tradeId: true, ruleId: true, createdAt: true },
    });
    const firstSeen = new Map(
      existing.map((r) => [`${r.tradeId}|${r.ruleId}`, r.createdAt]),
    );
    await tx.tradeRuleViolation.deleteMany({
      where: { trade: { userId } },
    });
    if (toWrite.length > 0) {
      await tx.tradeRuleViolation.createMany({
        data: toWrite.map((row) => ({
          ...row,
          createdAt:
            firstSeen.get(`${row.tradeId}|${row.ruleId}`) ?? new Date(),
        })),
      });
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
