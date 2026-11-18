/**
 * Performance report (MRT wave 3, work item 3) — server side.
 *
 * GET builds the report fresh from the selected period's closed trades
 * (same loader as the advanced analytics, so the numbers always agree
 * with the Analytics tabs) and runs the weekly plan engine on those
 * trades for the verdict, recommendations and costs. Read-only: unlike
 * the weekly plan endpoint, nothing is persisted here.
 */
import { computeAdvancedAnalytics } from "@/lib/analytics/advanced";
import { computeAdvancedStats } from "@/lib/analytics/insights";
import { computeTradeStats } from "@/lib/analytics/engine";
import {
  buildPerformanceReport,
  type PerformanceReport,
} from "@/lib/analytics/performance-report";
import { weekEndSunday, weekStartMonday } from "@/lib/analytics/weekly-plan";
import { loadAdvancedTradesCached } from "@/server/advanced-analytics";
import { tradingDayOfTrade } from "@/lib/time/trading-day";
import type { PerformanceReportPayload } from "@/lib/trading/dto";
import type { AnalyticsQuery } from "@/lib/validations/analytics";

export async function getPerformanceReport(
  userId: string,
  query: AnalyticsQuery
): Promise<PerformanceReportPayload> {
  const accountId = query.account ?? undefined;
  const { trades, timezone, currency, tradingDay } = await loadAdvancedTradesCached(
    userId,
    accountId,
    query.period
  );
  const stats = computeTradeStats(trades, {
    dayOf: tradingDayOfTrade(timezone, tradingDay),
  });
  const advancedStats = computeAdvancedStats(trades, stats);
  const computed = computeAdvancedAnalytics(trades, stats, advancedStats);
  const weekStart = weekStartMonday(new Date(), timezone);
  const report: PerformanceReport = buildPerformanceReport({
    trades,
    stats,
    advanced: advancedStats,
    score: computed.score,
    setups: computed.setups,
    sequences: computed.sequences,
    confluences: computed.confluences,
    weekStart,
    weekEnd: weekEndSunday(weekStart),
    currency,
  });
  return {
    period: query.period,
    accountId: accountId ?? null,
    currency,
    timezone,
    report,
  };
}
