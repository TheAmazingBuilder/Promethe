"use client";

import { useHashRoute } from "@/lib/router";
import { findNavItem } from "@/components/app/nav";
import { DashboardsView } from "@/components/dashboard/dashboards-view";
import { ToolsView } from "./tools-view";
import { SettingsView } from "./settings-view";
import { PlaceholderView } from "./placeholder-view";
import { CalendarView } from "@/components/calendar/calendar-view";
import { JournalView } from "@/components/journal/journal-view";
import { StrategiesView } from "@/components/strategies/strategies-view";
import { RulesView } from "@/components/rules/rules-view";
import { AccountsView } from "@/components/settings-views/accounts-view";
import { InstrumentsView } from "@/components/settings-views/instruments-view";
import { TagsView } from "@/components/settings-views/tags-view";
import { AnalyticsView } from "@/components/analytics/analytics-view";
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
import { LegalView } from "@/components/legal/legal-view";
import { FocusView } from "@/components/dashboard/focus-view";
import { AppearanceView } from "@/components/settings-views/appearance-view";
import { DashboardsSettingsView } from "@/components/settings-views/dashboards-settings-view";
import { PrivacyView } from "@/components/settings-views/privacy-view";
import { AccessibilityView } from "@/components/settings-views/accessibility-view";
import { TrashView } from "@/components/trash/trash-view";

/** No locked sections remain - phase 7 shipped every placeholder. */
const FEATURES: Record<string, string[]> = {};

export function ViewSwitch() {
  const route = useHashRoute();

  switch (route.view) {
    case "dashboard":
      return <DashboardsView />;
    case "focus":
      return <FocusView />;
    case "appearance-settings":
      return <AppearanceView />;
    case "privacy-settings":
      return <PrivacyView />;
    case "accessibility-settings":
      return <AccessibilityView />;
    case "dashboards-settings":
      return <DashboardsSettingsView />;
    case "analytics":
      return <AnalyticsView />;
    case "analytics-charts":
      return <ChartBuilderView />;
    case "analytics-heatmaps":
      return <HeatmapsView />;
    case "analytics-benchmark":
      return <BenchmarkView />;
    case "analytics-annotations":
      return <AnnotationsView />;
    case "calendar":
      return <CalendarView />;
    case "journal":
      return <JournalView date={route.journalDate} />;
    case "strategies":
      return <StrategiesView />;
    case "rules":
      return <RulesView />;
    case "accounts":
      return <AccountsView />;
    case "instruments":
      return <InstrumentsView />;
    case "tags":
      return <TagsView />;
    case "tools":
      return <ToolsView />;
    case "settings":
      return <SettingsView />;
    case "trades":
      return <TradesView />;
    case "trade":
      return <TradeDetailView tradeId={route.id ?? ""} />;
    case "trade-form":
      return <TradeFormView mode={route.mode ?? "create"} tradeId={route.id} />;
    case "quick-trade":
      return <QuickTradeView />;
    case "templates":
      return <TemplatesView />;
    case "broker-sync":
      return <BrokerSyncView />;
    case "import":
      return <ImportView />;
    case "reconciliation":
      return <ReconciliationView />;
    case "sharing":
      return <SharingView />;
    case "mentors":
      return <MentorsView />;
    case "mentor":
      return <MentorView />;
    case "mentor-owner":
      return <MentorOwnerView ownerId={route.ownerId ?? ""} />;
    case "mentor-trade":
      return (
        <MentorTradeView ownerId={route.ownerId ?? ""} tradeId={route.id ?? ""} />
      );
    case "invitation":
      return <InvitationView token={route.token ?? ""} />;
    case "account-settings":
      return <AccountSettingsView />;
    case "trash":
      return <TrashView />;
    case "legal":
      return <LegalView page={route.legalPage ?? "mentions"} />;
    default: {
      const item = findNavItem(route.view);
      if (!item || item.phase === null) {
        return <DashboardsView />;
      }
      return (
        <PlaceholderView
          titleKey={item.labelKey}
          descriptionKey={item.descriptionKey}
          icon={item.icon}
          phase={item.phase}
          featureKeys={FEATURES[route.view] ?? []}
        />
      );
    }
  }
}
