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
 * Phase 2 perf — the plan only needs 3 advanced modules (score,
 * setups, sequences), not the full 10. POST toggles one checkbox with a
 * single update when its row already exists (the GET syncs it); the
 * plan is rebuilt only when the row is missing.
 *
 * Persistence must never break the read path: a DB failure leaves the
 * computed plan (with unchecked boxes) intact.
 */
import { db } from "@/lib/db";
import {
  computeAdvancedAnalyticsModules,
} from "@/lib/analytics/advanced";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { computeTradeStats } from "@/lib/analytics/engine";
import {
  generateWeeklyPlan,
  weekEndSunday,
  weekStartMonday,
  type WeeklyPlan,
  type WeeklyPlanToggleResult,
  type WeeklyRuleKey,
} from "@/lib/analytics/weekly-plan";
import { loadAdvancedTradesCached } from "@/server/advanced-analytics";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { WeeklyPlanPayload } from "@/lib/trading/dto";
import type { WeeklyPlanQuery, WeeklyPlanToggle } from "@/lib/validations/analytics";

interface BuiltPlan {
  plan: WeeklyPlan;
  currency: string;
  timezone: string;
  accountId: string | null;
  excludedTradeCount: number;
}

async function buildPlan(
  userId: string,
  query: WeeklyPlanQuery
): Promise<BuiltPlan> {
  const accountId = query.account ?? undefined;
  const { trades, timezone, currency, tradingDay, excludedTradeCount } = await loadAdvancedTradesCached(
    userId,
    accountId,
    "30d"
  );
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  // Phase 2 perf — the plan only uses score, setups and sequences.
  const computed = computeAdvancedAnalyticsModules(trades, stats, advancedStats, [
    "score",
    "setups",
    "sequences",
  ]);
  const score = computed.score;
  const setups = computed.setups;
  const sequences = computed.sequences;
  if (score == null || setups == null || sequences == null) {
    throw new Error("[weekly-plan] required modules missing");
  }
  const weekStart = weekStartMonday(new Date(), timezone);
  const plan = generateWeeklyPlan({
    trades,
    stats,
    advanced: advancedStats,
    score,
    setups,
    sequences,
    weekStart,
    weekEnd: weekEndSunday(weekStart),
    currency,
  });
  return { plan, currency, timezone, accountId: accountId ?? null, excludedTradeCount };
}

/** Stable scope key: the global plan and every account have independent checkboxes. */
function weeklyPlanScopeKey(accountId: string | null): string {
  return accountId ?? "__all__";
}

/** Sync persisted checkboxes for one account scope with the freshly generated plan. */
export async function syncWeeklyPlanActions(
  userId: string,
  plan: WeeklyPlan,
  accountId: string | null = null
): Promise<Map<string, boolean>> {
  const doneByRule = new Map<string, boolean>();
  const weekStart = new Date(`${plan.weekStart}T00:00:00.000Z`);
  const scopeKey = weeklyPlanScopeKey(accountId);
  try {
    const rows = await db.weeklyPlanAction.findMany({
      where: { userId, weekStart, scopeKey },
    });
    for (const row of rows) doneByRule.set(row.rule, row.done);
    const liveRules = new Set(plan.actions.map((a) => a.rule));
    for (const action of plan.actions) {
      const prev = rows.find((r) => r.rule === action.rule);
      await db.weeklyPlanAction.upsert({
        where: {
          userId_weekStart_scopeKey_rule: { userId, weekStart, scopeKey, rule: action.rule },
        },
        update: { title: action.title, target: action.target },
        create: {
          userId,
          accountId,
          scopeKey,
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
          scopeKey,
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
  const { plan, currency, timezone, accountId, excludedTradeCount } = await buildPlan(
    userId,
    query
  );
  const doneByRule = await syncWeeklyPlanActions(userId, plan, accountId);
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
    excludedTradeCount,
    plan: withDone,
  };
}

/**
 * Toggle one "Done this week" checkbox. Fast path: the row already
 * exists (the plan GET syncs it), so one update is enough — no plan
 * rebuild. Slow path (first toggle before any GET, or a rule that is
 * not in this week's plan): rebuild the plan once to validate the rule
 * and get its title/target; unknown rules still return null.
 */
export async function toggleWeeklyPlanAction(
  userId: string,
  body: WeeklyPlanToggle,
  query: WeeklyPlanQuery = {}
): Promise<WeeklyPlanToggleResult | null> {
  const profile = await db.profile.findUnique({ where: { id: userId } });
  const timezone = profile?.timezone ?? "UTC";
  const weekStart = weekStartMonday(new Date(), timezone);
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
  const doneAt = body.done ? new Date() : null;
  const accountId = query.account ?? null;
  const scopeKey = weeklyPlanScopeKey(accountId);
  const updated = await db.weeklyPlanAction.updateMany({
    where: { userId, weekStart: weekStartDate, scopeKey, rule: body.rule },
    data: { done: body.done, doneAt },
  });
  if (updated.count > 0) {
    const row = await db.weeklyPlanAction.findUnique({
      where: {
        userId_weekStart_scopeKey_rule: { userId, weekStart: weekStartDate, scopeKey, rule: body.rule },
      },
    });
    if (row != null) {
      return {
        rule: body.rule,
        title: row.title,
        target: row.target,
        done: body.done,
      };
    }
    // Row vanished between the update and the read — fall through.
  }
  const { plan } = await buildPlan(userId, query);
  const action = plan.actions.find((a) => a.rule === body.rule);
  if (action == null) return null;
  const planWeekStart = new Date(`${plan.weekStart}T00:00:00.000Z`);
  await db.weeklyPlanAction.upsert({
    where: {
      userId_weekStart_scopeKey_rule: { userId, weekStart: planWeekStart, scopeKey, rule: body.rule },
    },
    update: { done: body.done, doneAt },
    create: {
      userId,
      accountId,
      scopeKey,
      weekStart: planWeekStart,
      rule: body.rule,
      title: action.title,
      target: action.target,
      done: body.done,
      doneAt,
    },
  });
  return {
    rule: action.rule,
    title: action.title,
    target: action.target,
    done: body.done,
  };
}
