"use client";

/**
 * WidgetRenderer — switches on the widget type and renders the matching
 * family component. Unknown types return null (the shell shows a placeholder).
 * Every renderer tolerates null / malformed data payloads.
 */
import * as React from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { KpiStripWidget } from "./kpi-strip-widget";
import { SingleKpiWidget } from "./single-kpi-widget";
import { PeriodCompareWidget } from "./period-compare-widget";
import {
  DrawdownCurveWidget,
  EquityCurveWidget,
} from "./equity-curve-widget";
import { PnlCalendarWidget } from "./pnl-calendar-widget";
import { OpenTradesWidget } from "./open-trades-widget";
import { RecentTradesWidget } from "./recent-trades-widget";
import { PerformanceChartWidget } from "./performance-chart-widget";
import { GroupTableWidget } from "./group-table-widget";
import { RHistogramWidget } from "./r-histogram-widget";
import { WinLossWidget } from "./win-loss-widget";
import { StreakWidget } from "./streak-widget";
import {
  GoalsProgressWidget,
  PropStatusWidget,
  SyncStatusWidget,
} from "./self-fetching-widgets";
import { JournalPromptWidget } from "./journal-prompt-widget";
import { ReviewQueueWidget } from "./review-queue-widget";
import { NextNewsWidget } from "./next-news-widget";
import { QuickActionsWidget } from "./quick-actions-widget";
import { StickyNoteWidget } from "./sticky-note-widget";
import { CustomMetricWidget } from "./custom-metric-widget";
import {
  HeatmapWidget,
  SavedChartWidget,
  YearCalendarWidget,
} from "./chart-widgets";
import { RiskBudgetWidget } from "./risk-budget-widget";
import { DisciplineScoreWidget } from "./discipline-score-widget";
import { TopLeaksWidget } from "./top-leaks-widget";
import { HabitsAtAGlanceWidget } from "./habits-at-a-glance-widget";
import "@/lib/dashboard/register-chart-widgets";
import "@/lib/dashboard/register-risk-reward-widgets";
import "@/lib/dashboard/register-mrt-wave2-widgets";

export interface WidgetRendererProps {
  type: string;
  /** The widget's entry from the batched data payload (may be null). */
  data: unknown;
  /** Raw widget config (unknown) - each family parses with its schema. */
  config: unknown;
  currency: string;
  timezone: string;
  /** Chart body height in px, derived from the grid layout height. */
  heightPx: number;
}

export function WidgetRenderer({
  type,
  data,
  config,
  currency,
  timezone,
  heightPx,
}: WidgetRendererProps) {
  const { locale } = useI18n();

  switch (type) {
    case "kpi-strip":
      return <KpiStripWidget data={data} config={config} currency={currency} />;
    case "single-kpi":
      return <SingleKpiWidget data={data} config={config} currency={currency} />;
    case "period-compare":
      return <PeriodCompareWidget data={data} config={config} currency={currency} />;
    case "equity-curve":
      return (
        <EquityCurveWidget
          data={data}
          currency={currency}
          timezone={timezone}
          heightPx={heightPx}
        />
      );
    case "drawdown-curve":
      return (
        <DrawdownCurveWidget
          data={data}
          currency={currency}
          timezone={timezone}
          heightPx={heightPx}
        />
      );
    case "pnl-calendar":
      return (
        <PnlCalendarWidget
          data={data}
          config={config}
          currency={currency}
          timezone={timezone}
          locale={locale}
        />
      );
    case "open-trades":
      return <OpenTradesWidget data={data} timezone={timezone} />;
    case "recent-trades":
      return <RecentTradesWidget data={data} config={config} timezone={timezone} />;
    case "session-performance":
      return (
        <PerformanceChartWidget
          data={data}
          currency={currency}
          heightPx={heightPx}
          dimension="session"
          locale={locale}
        />
      );
    case "weekday-performance":
      return (
        <PerformanceChartWidget
          data={data}
          currency={currency}
          heightPx={heightPx}
          dimension="weekday"
          locale={locale}
        />
      );
    case "hour-performance":
      return (
        <PerformanceChartWidget
          data={data}
          currency={currency}
          heightPx={heightPx}
          dimension="hour"
          locale={locale}
        />
      );
    case "strategy-table":
      return (
        <GroupTableWidget data={data} config={config} currency={currency} kind="strategy" />
      );
    case "instrument-table":
      return (
        <GroupTableWidget data={data} config={config} currency={currency} kind="instrument" />
      );
    case "r-histogram":
      return <RHistogramWidget data={data} heightPx={heightPx} />;
    case "win-loss":
      return <WinLossWidget data={data} heightPx={heightPx} />;
    case "streak":
      return <StreakWidget data={data} />;
    case "goals-progress":
      return <GoalsProgressWidget />;
    case "journal-prompt":
      return <JournalPromptWidget data={data} />;
    case "review-queue":
      return <ReviewQueueWidget data={data} />;
    case "next-news":
      return <NextNewsWidget data={data} timezone={timezone} />;
    case "prop-status":
      return <PropStatusWidget />;
    case "sync-status":
      return <SyncStatusWidget />;
    case "quick-actions":
      return <QuickActionsWidget />;
    case "sticky-note":
      return <StickyNoteWidget config={config} />;
    case "custom-metric":
      return <CustomMetricWidget data={data} />;
    case "saved-chart":
      return <SavedChartWidget config={config} heightPx={heightPx} />;
    case "heatmap":
      return <HeatmapWidget config={config} currency={currency} />;
    case "year-calendar":
      return <YearCalendarWidget />;
    case "risk-budget":
      return <RiskBudgetWidget />;
    case "discipline-score":
      return <DisciplineScoreWidget />;
    case "top-leaks":
      return <TopLeaksWidget />;
    case "habits-at-a-glance":
      return <HabitsAtAGlanceWidget />;
    default:
      return null;
  }
}
