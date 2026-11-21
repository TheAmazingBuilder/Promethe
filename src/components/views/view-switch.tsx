"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRoute } from "@/lib/router";
import { findNavItem } from "@/components/app/nav";
import { PlaceholderView } from "./placeholder-view";
import { Skeleton } from "@/components/ui/skeleton";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";

/**
 * Sober loading state while a view chunk loads on navigation. Plain
 * skeleton blocks, no spinner, no animation beyond the skeleton pulse.
 */
function ViewLoading() {
  return (
    <div aria-busy="true" className="space-y-4" aria-label="Loading view">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  );
}

// ── Views, one chunk each ────────────────────────────────────────────────────
// Every view is loaded on demand (next/dynamic, SSR kept): a page only
// downloads its own view + the shell, never the other 60+ views. The
// loading fallback above shows while the chunk loads on navigation.
const DashboardsView = dynamic(() => import("@/components/dashboard/dashboards-view").then((m) => m.DashboardsView), {
  loading: () => <ViewLoading />,
});
const ToolsView = dynamic(() => import("./tools-view").then((m) => m.ToolsView), {
  loading: () => <ViewLoading />,
});
const SettingsView = dynamic(() => import("./settings-view").then((m) => m.SettingsView), {
  loading: () => <ViewLoading />,
});
const CalendarView = dynamic(() => import("@/components/calendar/calendar-view").then((m) => m.CalendarView), {
  loading: () => <ViewLoading />,
});
const JournalView = dynamic(() => import("@/components/journal/journal-view").then((m) => m.JournalView), {
  loading: () => <ViewLoading />,
});
const GaiaView = dynamic(() => import("@/components/gaia/gaia-view").then((m) => m.GaiaView), {
  loading: () => <ViewLoading />,
});
const StrategiesView = dynamic(() => import("@/components/strategies/strategies-view").then((m) => m.StrategiesView), {
  loading: () => <ViewLoading />,
});
const PlaybookView = dynamic(() => import("@/components/playbook/playbook-view").then((m) => m.PlaybookView), {
  loading: () => <ViewLoading />,
});
const RulesView = dynamic(() => import("@/components/rules/rules-view").then((m) => m.RulesView), {
  loading: () => <ViewLoading />,
});
const AccountsView = dynamic(() => import("@/components/settings-views/accounts-view").then((m) => m.AccountsView), {
  loading: () => <ViewLoading />,
});
const InstrumentsView = dynamic(() => import("@/components/settings-views/instruments-view").then((m) => m.InstrumentsView), {
  loading: () => <ViewLoading />,
});
const TagsView = dynamic(() => import("@/components/settings-views/tags-view").then((m) => m.TagsView), {
  loading: () => <ViewLoading />,
});
const AnalyticsView = dynamic(() => import("@/components/analytics/analytics-view").then((m) => m.AnalyticsView), {
  loading: () => <ViewLoading />,
});
const LifecycleView = dynamic(() => import("@/components/analytics/lifecycle-view").then((m) => m.LifecycleView), {
  loading: () => <ViewLoading />,
});
const ExitsView = dynamic(() => import("@/components/analytics/exits-view").then((m) => m.ExitsView), {
  loading: () => <ViewLoading />,
});
const QualityView = dynamic(() => import("@/components/analytics/quality-view").then((m) => m.QualityView), {
  loading: () => <ViewLoading />,
});
const SetupsView = dynamic(() => import("@/components/analytics/setups-view").then((m) => m.SetupsView), {
  loading: () => <ViewLoading />,
});
const ConfluencesView = dynamic(() => import("@/components/analytics/confluences-view").then((m) => m.ConfluencesView), {
  loading: () => <ViewLoading />,
});
const GradesView = dynamic(() => import("@/components/analytics/grades-view").then((m) => m.GradesView), {
  loading: () => <ViewLoading />,
});
const SequencesView = dynamic(() => import("@/components/analytics/sequences-view").then((m) => m.SequencesView), {
  loading: () => <ViewLoading />,
});
const SeasonalityView = dynamic(() => import("@/components/analytics/seasonality-view").then((m) => m.SeasonalityView), {
  loading: () => <ViewLoading />,
});
const AnomaliesView = dynamic(() => import("@/components/analytics/anomalies-view").then((m) => m.AnomaliesView), {
  loading: () => <ViewLoading />,
});
const WeeklyPlanView = dynamic(() => import("@/components/analytics/weekly-plan-view").then((m) => m.WeeklyPlanView), {
  loading: () => <ViewLoading />,
});
const GoalsView = dynamic(() => import("@/components/analytics/goals-view").then((m) => m.GoalsView), {
  loading: () => <ViewLoading />,
});
const PerformanceReportView = dynamic(() => import("@/components/analytics/performance-report-view").then((m) => m.PerformanceReportView), {
  loading: () => <ViewLoading />,
});
const ChartBuilderView = dynamic(() => import("@/components/charts/chart-builder-view").then((m) => m.ChartBuilderView), {
  loading: () => <ViewLoading />,
});
const HeatmapsView = dynamic(() => import("@/components/charts/heatmap-view").then((m) => m.HeatmapsView), {
  loading: () => <ViewLoading />,
});
const BenchmarkView = dynamic(() => import("@/components/charts/benchmark-view").then((m) => m.BenchmarkView), {
  loading: () => <ViewLoading />,
});
const AnnotationsView = dynamic(() => import("@/components/charts/annotations-view").then((m) => m.AnnotationsView), {
  loading: () => <ViewLoading />,
});
const TradesView = dynamic(() => import("@/components/trades/trades-view").then((m) => m.TradesView), {
  loading: () => <ViewLoading />,
});
const TradeDetailView = dynamic(() => import("@/components/trades/trade-detail-view").then((m) => m.TradeDetailView), {
  loading: () => <ViewLoading />,
});
const TradeFormView = dynamic(() => import("@/components/trades/trade-form-view").then((m) => m.TradeFormView), {
  loading: () => <ViewLoading />,
});
const QuickTradeView = dynamic(() => import("@/components/quick/quick-trade-view").then((m) => m.QuickTradeView), {
  loading: () => <ViewLoading />,
});
const TemplatesView = dynamic(() => import("@/components/templates/templates-view").then((m) => m.TemplatesView), {
  loading: () => <ViewLoading />,
});
const BrokerSyncView = dynamic(() => import("@/components/broker-sync/broker-sync-view").then((m) => m.BrokerSyncView), {
  loading: () => <ViewLoading />,
});
const ImportView = dynamic(() => import("@/components/import/import-view").then((m) => m.ImportView), {
  loading: () => <ViewLoading />,
});
const ReconciliationView = dynamic(() => import("@/components/reconciliation/reconciliation-view").then((m) => m.ReconciliationView), {
  loading: () => <ViewLoading />,
});
const SharingView = dynamic(() => import("@/components/sharing/sharing-view").then((m) => m.SharingView), {
  loading: () => <ViewLoading />,
});
const MentorsView = dynamic(() => import("@/components/mentors/mentors-view").then((m) => m.MentorsView), {
  loading: () => <ViewLoading />,
});
const MentorView = dynamic(() => import("@/components/mentor/mentor-view").then((m) => m.MentorView), {
  loading: () => <ViewLoading />,
});
const MentorOwnerView = dynamic(() => import("@/components/mentor/mentor-owner-view").then((m) => m.MentorOwnerView), {
  loading: () => <ViewLoading />,
});
const MentorTradeView = dynamic(() => import("@/components/mentor/mentor-trade-view").then((m) => m.MentorTradeView), {
  loading: () => <ViewLoading />,
});
const InvitationView = dynamic(() => import("@/components/mentor/invitation-view").then((m) => m.InvitationView), {
  loading: () => <ViewLoading />,
});
const AccountSettingsView = dynamic(() => import("@/components/settings/account-settings-view").then((m) => m.AccountSettingsView), {
  loading: () => <ViewLoading />,
});
const ProfileView = dynamic(() => import("@/components/profile/profile-view").then((m) => m.ProfileView), {
  loading: () => <ViewLoading />,
});
const LegalView = dynamic(() => import("@/components/legal/legal-view").then((m) => m.LegalView), {
  loading: () => <ViewLoading />,
});
const FocusView = dynamic(() => import("@/components/dashboard/focus-view").then((m) => m.FocusView), {
  loading: () => <ViewLoading />,
});
const AppearanceView = dynamic(() => import("@/components/settings-views/appearance-view").then((m) => m.AppearanceView), {
  loading: () => <ViewLoading />,
});
const DashboardsSettingsView = dynamic(() => import("@/components/settings-views/dashboards-settings-view").then((m) => m.DashboardsSettingsView), {
  loading: () => <ViewLoading />,
});
const PrivacyView = dynamic(() => import("@/components/settings-views/privacy-view").then((m) => m.PrivacyView), {
  loading: () => <ViewLoading />,
});
const AccessibilityView = dynamic(() => import("@/components/settings-views/accessibility-view").then((m) => m.AccessibilityView), {
  loading: () => <ViewLoading />,
});
const TimeView = dynamic(() => import("@/components/settings-views/time-view").then((m) => m.TimeView), {
  loading: () => <ViewLoading />,
});
const CustomFieldsView = dynamic(() => import("@/components/settings-views/custom-fields-view").then((m) => m.CustomFieldsView), {
  loading: () => <ViewLoading />,
});
const ShortcutsView = dynamic(() => import("@/components/settings-views/shortcuts-view").then((m) => m.ShortcutsView), {
  loading: () => <ViewLoading />,
});
const IntegrationsView = dynamic(() => import("@/components/settings-views/integrations-view").then((m) => m.IntegrationsView), {
  loading: () => <ViewLoading />,
});
const SearchView = dynamic(() => import("@/components/search/search-view").then((m) => m.SearchView), {
  loading: () => <ViewLoading />,
});
const HistoryView = dynamic(() => import("@/components/history/history-view").then((m) => m.HistoryView), {
  loading: () => <ViewLoading />,
});
const TrashView = dynamic(() => import("@/components/trash/trash-view").then((m) => m.TrashView), {
  loading: () => <ViewLoading />,
});


/** No locked sections remain - phase 7 shipped every placeholder. */
const FEATURES: Record<string, string[]> = {};

export function ViewSwitch() {
  const route = useRoute();
  const { reducedMotionActive: reduceMotion } = useA11yPrefs();
  // Key changes only when the page itself changes - query params (filters,
  // drill-downs) keep the same view mounted, no transition replay.
  const viewKey = [
    route.view,
    route.id,
    route.mode,
    route.ownerId,
    route.token,
    route.legalPage,
    route.journalDate,
  ]
    .filter(Boolean)
    .join("/");

  let view: React.ReactNode;
  switch (route.view) {
    case "dashboard":
      view = <DashboardsView />;
      break;
    case "focus":
      view = <FocusView />;
      break;
    case "appearance-settings":
      view = <AppearanceView />;
      break;
    case "privacy-settings":
      view = <PrivacyView />;
      break;
    case "accessibility-settings":
      view = <AccessibilityView />;
      break;
    case "time-settings":
      view = <TimeView />;
      break;
    case "custom-fields-settings":
      view = <CustomFieldsView />;
      break;
    case "shortcuts-settings":
      view = <ShortcutsView />;
      break;
    case "integrations-settings":
      view = <IntegrationsView />;
      break;
    case "search":
      view = <SearchView />;
      break;
    case "history":
      view = <HistoryView />;
      break;
    case "dashboards-settings":
      view = <DashboardsSettingsView />;
      break;
    case "analytics":
      view = <AnalyticsView />;
      break;
    case "analytics-lifecycle":
      view = <LifecycleView />;
      break;
    case "analytics-exits":
      view = <ExitsView />;
      break;
    case "analytics-quality":
      view = <QualityView />;
      break;
    case "analytics-setups":
      view = <SetupsView />;
      break;
    case "analytics-confluences":
      view = <ConfluencesView />;
      break;
    case "analytics-grades":
      view = <GradesView />;
      break;
    case "analytics-sequences":
      view = <SequencesView />;
      break;
    case "analytics-seasonality":
      view = <SeasonalityView />;
      break;
    case "analytics-anomalies":
      view = <AnomaliesView />;
      break;
    case "analytics-weekly-plan":
      view = <WeeklyPlanView />;
      break;
    case "analytics-goals":
      view = <GoalsView />;
      break;
    case "analytics-performance-report":
      view = <PerformanceReportView />;
      break;
    case "analytics-charts":
      view = <ChartBuilderView />;
      break;
    case "analytics-heatmaps":
      view = <HeatmapsView />;
      break;
    case "analytics-benchmark":
      view = <BenchmarkView />;
      break;
    case "analytics-annotations":
      view = <AnnotationsView />;
      break;
    case "calendar":
      view = <CalendarView />;
      break;
    case "journal":
      view = <JournalView date={route.journalDate} />;
      break;
    case "gaia":
      view = <GaiaView />;
      break;
    case "strategies":
      view = <StrategiesView />;
      break;
    case "playbook":
      view = <PlaybookView />;
      break;
    case "rules":
      view = <RulesView />;
      break;
    case "accounts":
      view = <AccountsView />;
      break;
    case "instruments":
      view = <InstrumentsView />;
      break;
    case "tags":
      view = <TagsView />;
      break;
    case "tools":
      view = <ToolsView />;
      break;
    case "settings":
      view = <SettingsView />;
      break;
    case "trades":
      view = <TradesView />;
      break;
    case "trade":
      view = <TradeDetailView tradeId={route.id ?? ""} />;
      break;
    case "trade-form":
      view = <TradeFormView mode={route.mode ?? "create"} tradeId={route.id} />;
      break;
    case "quick-trade":
      view = <QuickTradeView />;
      break;
    case "templates":
      view = <TemplatesView />;
      break;
    case "broker-sync":
      view = <BrokerSyncView />;
      break;
    case "import":
      view = <ImportView />;
      break;
    case "reconciliation":
      view = <ReconciliationView />;
      break;
    case "sharing":
      view = <SharingView />;
      break;
    case "mentors":
      view = <MentorsView />;
      break;
    case "mentor":
      view = <MentorView />;
      break;
    case "mentor-owner":
      view = <MentorOwnerView ownerId={route.ownerId ?? ""} />;
      break;
    case "mentor-trade":
      view = (
        <MentorTradeView ownerId={route.ownerId ?? ""} tradeId={route.id ?? ""} />
      );
      break;
    case "invitation":
      view = <InvitationView token={route.token ?? ""} />;
      break;
    case "account-settings":
      view = <AccountSettingsView />;
      break;
    case "profile-settings":
      view = <ProfileView />;
      break;
    case "trash":
      view = <TrashView />;
      break;
    case "legal":
      view = <LegalView page={route.legalPage ?? "terms"} />;
      break;
    default: {
      const item = findNavItem(route.view);
      if (!item || item.phase === null) {
        view = <DashboardsView />;
      } else {
        view = (
          <PlaceholderView
            titleKey={item.labelKey}
            descriptionKey={item.descriptionKey}
            icon={item.icon}
            phase={item.phase}
            featureKeys={FEATURES[route.view] ?? []}
          />
        );
      }
      break;
    }
  }

  // Keep hooks unconditional: reduced-motion preferences may change at runtime.
  // Short opacity-only fade between pages (150 ms, CSS keyframe in
  // globals.css). The first mount skips the fade - the dashboard widgets
  // already have their own entrance animation. Replaces the previous
  // framer-motion AnimatePresence (same 150 ms, same ease).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    firstRender.current = false;
  }, []);

  // Reduced motion: no transition at all, the page just swaps.
  if (reduceMotion) return <>{view}</>;
  return (
    <div
      key={viewKey}
      className={firstRender.current ? undefined : "view-fade-in"}
    >
      {view}
    </div>
  );
}
