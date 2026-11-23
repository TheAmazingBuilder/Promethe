/**
 * Performance report (MRT wave 3, work item 3) — server side.
 *
 * GET builds the report fresh from the selected period's closed trades
 * (same loader as the advanced analytics, so the numbers always agree
 * with the Analytics tabs) and runs the weekly plan engine on those
 * trades for the verdict, recommendations and costs. Read-only: unlike
 * the weekly plan endpoint, nothing is persisted here — except the
 * "Done this week" checkboxes of the embedded plan, synced like the
 * weekly plan GET does.
 *
 * Phase 2 perf — the report only needs 4 advanced modules (score,
 * setups, sequences, confluences), not the full 10. The weekly plan
 * shown under the report is embedded in this payload instead of a
 * second GET /api/weekly-plan: at the default 30d period it is built
 * from the very same loaded trades and the same plan generation the
 * report already runs; at any other period it is the standard 30d plan
 * (loaded in parallel, cached 45 s). One call, one 30d computation.
 */
import { computeAdvancedAnalyticsModules } from "@/lib/analytics/advanced";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { computeTradeStats } from "@/lib/analytics/engine";
import {
  buildPerformanceReport,
  type PerformanceReport,
} from "@/lib/analytics/performance-report";
import {
  generateWeeklyPlan,
  weekEndSunday,
  weekStartMonday,
  type WeeklyPlan,
} from "@/lib/analytics/weekly-plan";
import { loadAdvancedTradesCached } from "@/server/advanced-analytics";
import { syncWeeklyPlanActions } from "@/server/weekly-plan";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { PerformanceReportPayload } from "@/lib/trading/dto";
import type { AnalyticsQuery } from "@/lib/validations/analytics";

export async function getPerformanceReport(
  userId: string,
  query: AnalyticsQuery
): Promise<PerformanceReportPayload> {
  const accountId = query.account ?? undefined;
  // The 30d plan load is independent of the report period: run it in
  // parallel when the report covers another period, skip it at 30d
  // (the report load IS the plan load there).
  const [main, loaded30] = await Promise.all([
    loadAdvancedTradesCached(userId, accountId, query.period),
    query.period === "30d"
      ? Promise.resolve(null)
      : loadAdvancedTradesCached(userId, accountId, "30d"),
  ]);
  const { trades, timezone, currency, tradingDay, excludedTradeCount } = main;
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  // Phase 2 perf — the report only uses score, setups, sequences and
  // confluences.
  const computed = computeAdvancedAnalyticsModules(trades, stats, advancedStats, [
    "score",
    "setups",
    "sequences",
    "confluences",
  ]);
  const score = computed.score;
  const setups = computed.setups;
  const sequences = computed.sequences;
  const confluences = computed.confluences;
  if (
    score == null ||
    setups == null ||
    sequences == null ||
    confluences == null
  ) {
    throw new Error("[performance-report] required modules missing");
  }
  const weekStart = weekStartMonday(new Date(), timezone);
  const weekEnd = weekEndSunday(weekStart);
  // The weekly plan shown under the report is the standard 30d plan.
  // At 30d it shares this load and this generation with the report;
  // otherwise it is generated from the parallel 30d load.
  let plan: WeeklyPlan;
  let reportPlan: WeeklyPlan | undefined;
  if (loaded30 == null) {
    plan = generateWeeklyPlan({
      trades,
      stats,
      advanced: advancedStats,
      score,
      setups,
      sequences,
      weekStart,
      weekEnd,
      currency,
    });
    reportPlan = plan;
  } else {
    const stats30 = computeTradeStats(loaded30.trades, {
      dayOf: tradingDayOfTrade(loaded30.timezone, loaded30.tradingDay),
    });
    const advancedStats30 = computeAdvancedStats(loaded30.trades, stats30);
    const computed30 = computeAdvancedAnalyticsModules(
      loaded30.trades,
      stats30,
      advancedStats30,
      ["score", "setups", "sequences"]
    );
    if (
      computed30.score == null ||
      computed30.setups == null ||
      computed30.sequences == null
    ) {
      throw new Error("[performance-report] required plan modules missing");
    }
    plan = generateWeeklyPlan({
      trades: loaded30.trades,
      stats: stats30,
      advanced: advancedStats30,
      score: computed30.score,
      setups: computed30.setups,
      sequences: computed30.sequences,
      weekStart,
      weekEnd,
      currency: loaded30.currency,
    });
  }
  const report: PerformanceReport = buildPerformanceReport({
    trades,
    stats,
    advanced: advancedStats,
    score,
    setups,
    sequences,
    confluences,
    weekStart,
    weekEnd,
    currency,
    plan: reportPlan,
  });
  const doneByRule = await syncWeeklyPlanActions(userId, plan);
  const actions = plan.actions.map((a) => ({
    ...a,
    done: doneByRule.get(a.rule) ?? false,
  }));
  const planWithDone: WeeklyPlan = {
    ...plan,
    actions,
    fixFirst: actions[0] ?? null,
  };
  return {
    period: query.period,
    accountId: accountId ?? null,
    currency,
    timezone,
    excludedTradeCount,
    report,
    plan: planWithDone,
  };
}
