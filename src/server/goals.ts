/**
 * Goals CRUD + live progression (v1 phase 6).
 *
 * Progression reuses the pure engine over the user's closed non-draft
 * trades (exit-day attribution) + journal discipline scores. ACHIEVED /
 * MISSED are COMPUTED at read time — the stored status only carries the
 * user's intent (ACTIVE | PAUSED), so a goal never needs a backfill job.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeGoalProgress, type GoalDef } from "@/lib/trading/goals";
import type { GoalDTO, GoalsPayload } from "@/lib/trading/dto";
import type { GoalInput, GoalPatch } from "@/lib/validations/goals";
import { getDisplayPreferences } from "@/server/display-preferences";

type GoalRow = Prisma.GoalGetPayload<Record<string, never>>;

function toGoalDTO(g: GoalRow): GoalDTO {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    metric: g.metric,
    targetValue: g.targetValue.toString(),
    period: g.period,
    startDate: g.startDate.toISOString().slice(0, 10),
    endDate: g.endDate ? g.endDate.toISOString().slice(0, 10) : null,
    status: g.status,
    createdAt: g.createdAt.toISOString(),
  };
}

/** Goals + computed progress, dashboard-ready. */
export async function listGoalsWithProgress(
  userId: string
): Promise<GoalsPayload> {
  const [profile, goals, trades, reviews, screenshots, journal, prefs] =
    await Promise.all([
      db.profile.findUnique({ where: { id: userId } }),
      db.goal.findMany({ where: { userId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
      db.trade.findMany({
        where: { userId, status: "CLOSED", isDraft: false },
        select: {
          id: true,
          exitTime: true,
          netPnl: true,
          rMultiple: true,
          grade: true,
          followedPlan: true,
        },
      }),
      // Plan verdicts live on TradeReview (one per trade, declared at
      // review time), not on Trade: playbookMatch + followedPlan.
      db.tradeReview.findMany({
        where: { userId },
        select: { tradeId: true, playbookMatch: true, followedPlan: true },
      }),
      // Trades with at least one screenshot (TRADES_WITH_SCREENSHOT).
      db.tradeScreenshot.findMany({
        where: { userId },
        select: { tradeId: true },
      }),
      db.journalEntry.findMany({
        where: { userId, disciplineScore: { not: null } },
        select: { date: true, disciplineScore: true },
      }),
      getDisplayPreferences(userId),
    ]);
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const screenshotTradeIds = new Set(screenshots.map((s) => s.tradeId));
  const reviewByTradeId = new Map(
    reviews.map((r) => [r.tradeId, r] as const)
  );

  const tradePoints = trades.map((t) => {
    const review = reviewByTradeId.get(t.id);
    return {
      exitIso: (t.exitTime ?? new Date(0)).toISOString(),
      netPnl: t.netPnl?.toString() ?? null,
      rMultiple: t.rMultiple?.toString() ?? null,
      // Real setup grade (A+ | A | B | C, null = ungraded) from the
      // wave-3 grades chantier; A_PLUS_WIN_RATE counts A+ trades only.
      grade: t.grade,
      // Review verdict wins; the trade's own followedPlan is the fallback
      // for trades recorded before the Playbook review.
      playbookMatch: review?.playbookMatch ?? null,
      followedPlan: review?.followedPlan ?? t.followedPlan ?? null,
      hasScreenshot: screenshotTradeIds.has(t.id),
    };
  });
  const discipline = journal
    .filter((j) => j.disciplineScore != null)
    .map((j) => ({ date: j.date, score: j.disciplineScore as number }));

  return {
    timezone,
    goals: goals.map((g) => {
      const def = rowToDef(g);
      return {
        ...toGoalDTO(g),
        progress: computeGoalProgress(
          def,
          tradePoints,
          discipline,
          now,
          timezone,
          prefs.tradingDay
        ),
      };
    }),
  };
}

function rowToDef(g: GoalRow): GoalDef {
  return {
    id: g.id,
    name: g.name,
    metric: g.metric as GoalDef["metric"],
    targetValue: g.targetValue.toString(),
    period: g.period as GoalDef["period"],
    startDate: g.startDate.toISOString().slice(0, 10),
    endDate: g.endDate ? g.endDate.toISOString().slice(0, 10) : null,
  };
}

export async function createGoal(
  userId: string,
  input: GoalInput
): Promise<GoalDTO> {
  const row = await db.goal.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      metric: input.metric,
      targetValue: input.targetValue,
      period: input.period,
      startDate: new Date(`${input.startDate}T00:00:00Z`),
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null,
      status: input.status,
    },
  });
  return toGoalDTO(row);
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: GoalPatch
): Promise<GoalDTO | null> {
  const existing = await db.goal.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await db.goal.update({
    where: { id },
    data: {
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description ?? null }
        : {}),
      ...(patch.metric != null ? { metric: patch.metric } : {}),
      ...(patch.targetValue != null ? { targetValue: patch.targetValue } : {}),
      ...(patch.period != null ? { period: patch.period } : {}),
      ...(patch.startDate != null
        ? { startDate: new Date(`${patch.startDate}T00:00:00Z`) }
        : {}),
      ...(patch.endDate !== undefined
        ? { endDate: patch.endDate ? new Date(`${patch.endDate}T00:00:00Z`) : null }
        : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
    },
  });
  return toGoalDTO(row);
}

export async function deleteGoal(userId: string, id: string): Promise<boolean> {
  const existing = await db.goal.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.goal.delete({ where: { id } });
  return true;
}
