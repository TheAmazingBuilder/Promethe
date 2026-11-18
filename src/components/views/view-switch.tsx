"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRoute } from "@/lib/router";
import { findNavItem } from "@/components/app/nav";
import { DashboardsView } from "@/components/dashboard/dashboards-view";
import { ToolsView } from "./tools-view";
import { SettingsView } from "./settings-view";
import { PlaceholderView } from "./placeholder-view";
import { CalendarView } from "@/components/calendar/calendar-view";
import { JournalView } from "@/components/journal/journal-view";
import { GaiaView } from "@/components/gaia/gaia-view";
import { StrategiesView } from "@/components/strategies/strategies-view";
import { PlaybookView } from "@/components/playbook/playbook-view";
import { RulesView } from "@/components/rules/rules-view";
import { AccountsView } from "@/components/settings-views/accounts-view";
import { InstrumentsView } from "@/components/settings-views/instruments-view";
import { TagsView } from "@/components/settings-views/tags-view";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { LifecycleView } from "@/components/analytics/lifecycle-view";
import { ExitsView } from "@/components/analytics/exits-view";
import { QualityView } from "@/components/analytics/quality-view";
import { SetupsView } from "@/components/analytics/setups-view";
import { ConfluencesView } from "@/components/analytics/confluences-view";
import { GradesView } from "@/components/analytics/grades-view";
import { SequencesView } from "@/components/analytics/sequences-view";
import { SeasonalityView } from "@/components/analytics/seasonality-view";
import { AnomaliesView } from "@/components/analytics/anomalies-view";
import { WeeklyPlanView } from "@/components/analytics/weekly-plan-view";
import { PerformanceReportView } from "@/components/analytics/performance-report-view";
import { ChartBuilderView } from "@/components/charts/chart-builder-view";
import { HeatmapsView } from "@/components/charts/heatmap-view";
import { BenchmarkView } from "@/components/charts/benchmark-view";
import { AnnotationsView } from "@/components/charts/annotations-view";
import { TradesView } from "@/components/trades/trades-view";
import { TradeDetailView } from "@/components/trades/trade-detail-view";
import { TradeFormView } from "@/components/trades/trade-form-view";
import { QuickTradeView } from "@/components/quick/quick-trade-view";
import { TemplatesView } from "@/components/templates/templates-view";
import { BrokerSyncView } from "@/components/broker-sync/broker-sync-view";
import { ImportView } from "@/components/import/import-view";
import { ReconciliationView } from "@/components/reconciliation/reconciliation-view";
import { SharingView } from "@/components/sharing/sharing-view";
import { MentorsView } from "@/components/mentors/mentors-view";
import { MentorView } from "@/components/mentor/mentor-view";
import { MentorOwnerView } from "@/components/mentor/mentor-owner-view";
import { MentorTradeView } from "@/components/mentor/mentor-trade-view";
import { InvitationView } from "@/components/mentor/invitation-view";
import { AccountSettingsView } from "@/components/settings/account-settings-view";
import { ProfileView } from "@/components/profile/profile-view";
import { LegalView } from "@/components/legal/legal-view";
import { FocusView } from "@/components/dashboard/focus-view";
import { AppearanceView } from "@/components/settings-views/appearance-view";
import { DashboardsSettingsView } from "@/components/settings-views/dashboards-settings-view";
import { PrivacyView } from "@/components/settings-views/privacy-view";
import { AccessibilityView } from "@/components/settings-views/accessibility-view";
import { TimeView } from "@/components/settings-views/time-view";
import { CustomFieldsView } from "@/components/settings-views/custom-fields-view";
import { ShortcutsView } from "@/components/settings-views/shortcuts-view";
import { IntegrationsView } from "@/components/settings-views/integrations-view";
import { SearchView } from "@/components/search/search-view";
import { HistoryView } from "@/components/history/history-view";
import { TrashView } from "@/components/trash/trash-view";

/** No locked sections remain - phase 7 shipped every placeholder. */
const FEATURES: Record<string, string[]> = {};

export function ViewSwitch() {
  const route = useRoute();
  const reduceMotion = useReducedMotion();
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

  // Reduced motion: no transition at all, the page just swaps.
  if (reduceMotion) return <>{view}</>;

  // Short opacity-only fade between pages (150 ms). mode="wait" keeps a
  // single page in the layout so the content never stacks or jumps.
  // initial={false} skips the fade on first load - the dashboard widgets
  // already have their own entrance animation.
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={viewKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {view}
      </motion.div>
    </AnimatePresence>
  );
}
