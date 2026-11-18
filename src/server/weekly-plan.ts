/**
 * Weekly improvement plan (MRT wave 1, chantier 1) — server side.
 *
 * GET builds the plan fresh from the last 30 days of closed trades
 * (same loader as the advanced analytics, so the numbers always agree
 * with the Analytics tabs) and persists the "Done this week" checkboxes
 * in WeeklyPlanAction rows, one per generated action of the current
 * Monday-Sunday week. Regeneration is idempotent: rows for rules that
 * still fire are upserted (title/target refreshed, `done` kept), rows
 * for rules that no longer fire are removed for that week.
 *
 * Persistence must never break the read path: a DB failure leaves the
 * computed plan (with unchecked boxes) intact.
 */
import { db } from "@/lib/db";
import {
  computeAdvancedAnalytics,
} from "@/lib/analytics/advanced";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { computeTradeStats } from "@/lib/analytics/engine";
import {
  generateWeeklyPlan,
  weekEndSunday,
  weekStartMonday,
  type PlanAction,
  type WeeklyPlan,
  type WeeklyRuleKey,
} from "@/lib/analytics/weekly-plan";
import { loadAdvancedTrades } from "@/server/advanced-analytics";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { WeeklyPlanPayload } from "@/lib/trading/dto";
import type { WeeklyPlanQuery, WeeklyPlanToggle } from "@/lib/validations/analytics";

interface BuiltPlan {
  plan: WeeklyPlan;
  currency: string;
  timezone: string;
  accountId: string | null;
}

async function buildPlan(
  userId: string,
  query: WeeklyPlanQuery
): Promise<BuiltPlan> {
  const accountId = query.account ?? undefined;
  const { trades, timezone, currency, tradingDay } = await loadAdvancedTrades(
    userId,
    accountId,
    "30d"
  );
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  const computed = computeAdvancedAnalytics(trades, stats, advancedStats);
  const weekStart = weekStartMonday(new Date(), timezone);
  const plan = generateWeeklyPlan({
    trades,
    stats,
    advanced: advancedStats,
    score: computed.score,
    setups: computed.setups,
    sequences: computed.sequences,
    weekStart,
    weekEnd: weekEndSunday(weekStart),
    currency,
  });
  return { plan, currency, timezone, accountId: accountId ?? null };
}

/** Sync the persisted checkboxes with the freshly generated plan. */
async function syncActions(
  userId: string,
  plan: WeeklyPlan
): Promise<Map<string, boolean>> {
  const doneByRule = new Map<string, boolean>();
  const weekStart = new Date(`${plan.weekStart}T00:00:00.000Z`);
  try {
    const rows = await db.weeklyPlanAction.findMany({
      where: { userId, weekStart },
    });
    for (const row of rows) doneByRule.set(row.rule, row.done);
    const liveRules = new Set(plan.actions.map((a) => a.rule));
    for (const action of plan.actions) {
      const prev = rows.find((r) => r.rule === action.rule);
      await db.weeklyPlanAction.upsert({
        where: {
          userId_weekStart_rule: { userId, weekStart, rule: action.rule },
        },
        update: { title: action.title, target: action.target },
        create: {
          userId,
          weekStart,
          rule: action.rule,
          title: action.title,
          target: action.target,
          done: false,
        },
      });
      if (prev != null) doneByRule.set(action.rule, prev.done);
    }
    // Rows store the rule as a plain string; only our own rule keys are
    // ever written, so the cast below is safe.
    const stale = rows.filter(
      (r) => !liveRules.has(r.rule as WeeklyRuleKey)
    );
    if (stale.length > 0) {
      await db.weeklyPlanAction.deleteMany({
        where: {
          userId,
          weekStart,
          rule: { in: stale.map((r) => r.rule) },
        },
      });
    }
  } catch (error) {
    // Persistence must never break the read path.
    console.error("[weekly-plan] checkbox sync failed", error);
  }
  return doneByRule;
}

export async function getWeeklyPlan(
  userId: string,
  query: WeeklyPlanQuery
): Promise<WeeklyPlanPayload> {
  const { plan, currency, timezone, accountId } = await buildPlan(
    userId,
    query
  );
  const doneByRule = await syncActions(userId, plan);
  const actions = plan.actions.map((a) => ({
    ...a,
    done: doneByRule.get(a.rule) ?? false,
  }));
  const withDone: WeeklyPlan = {
    ...plan,
    actions,
    fixFirst: actions[0] ?? null,
  };
  return {
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    accountId,
    currency,
    timezone,
    plan: withDone,
  };
}

/**
 * Toggle one "Done this week" checkbox. The rule must belong to the
 * current week's generated plan; otherwise null (unknown rule for this
 * week — the plan is rule-generated, never hand-written).
 */
export async function toggleWeeklyPlanAction(
  userId: string,
  body: WeeklyPlanToggle,
  query: WeeklyPlanQuery = {}
): Promise<PlanAction | null> {
  const { plan } = await buildPlan(userId, query);
  const action = plan.actions.find((a) => a.rule === body.rule);
  if (action == null) return null;
  const weekStart = new Date(`${plan.weekStart}T00:00:00.000Z`);
  const doneAt = body.done ? new Date() : null;
  await db.weeklyPlanAction.upsert({
    where: {
      userId_weekStart_rule: { userId, weekStart, rule: body.rule },
    },
    update: { done: body.done, doneAt },
    create: {
      userId,
      weekStart,
      rule: body.rule,
      title: action.title,
      target: action.target,
      done: body.done,
      doneAt,
    },
  });
  return { ...action, done: body.done };
}
