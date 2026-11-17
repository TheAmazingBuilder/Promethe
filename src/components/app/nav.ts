/**
 * Application navigation — single source of truth for the sidebar, the mobile
 * sheet, the command palette and the header title. Labels and descriptions are
 * absolute i18n message keys (see messages/fr.json & messages/en.json).
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  CandlestickChart,
  Calculator,
  Coins,
  Crosshair,
  EyeOff,
  GitMerge,
  GraduationCap,
  Grid3x3,
  LayoutDashboard,
  LayoutTemplate,
  LineChart,
  Link2,
  ListChecks,
  NotebookPen,
  Palette,
  Plug,
  Settings,
  ShieldCheck,
  Tags,
  Target,
  Trash2,
  Upload,
  Users,
  Accessibility,
  Wallet,
  Zap,
} from "lucide-react";
import type { ViewId } from "@/lib/router";

export interface NavItem {
  /** Absolute message key, e.g. "nav.dashboard". */
  labelKey: string;
  /** Absolute message key, e.g. "nav.dashboardDesc". */
  descriptionKey: string;
  path: string;
  view: ViewId;
  icon: LucideIcon;
  /** Roadmap phase (README) - null when the section is already live. */
  phase: number | null;
  ready: boolean;
  /** v3 Phase 5 - only shown when the user mentors at least one trader. */
  mentorOnly?: boolean;
}

export interface NavGroup {
  /** Absolute message key, e.g. "nav.groups.tracking". */
  labelKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.groups.tracking",
    items: [
      {
        labelKey: "nav.dashboard",
        descriptionKey: "nav.dashboardDesc",
        path: "#/",
        view: "dashboard",
        icon: LayoutDashboard,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.focus",
        descriptionKey: "nav.focusDesc",
        path: "#/focus",
        view: "focus",
        icon: Crosshair,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.quickTrade",
        descriptionKey: "nav.quickTradeDesc",
        path: "#/trades/quick",
        view: "quick-trade",
        icon: Zap,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.trades",
        descriptionKey: "nav.tradesDesc",
        path: "#/trades",
        view: "trades",
        icon: CandlestickChart,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.calendar",
        descriptionKey: "nav.calendarDesc",
        path: "#/calendrier",
        view: "calendar",
        icon: CalendarDays,
        phase: null,
        ready: true,
      },
    ],
  },
  {
    labelKey: "nav.groups.analysis",
    items: [
      {
        labelKey: "nav.analytics",
        descriptionKey: "nav.analyticsDesc",
        path: "#/analytics",
        view: "analytics",
        icon: BarChart3,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.chartBuilder",
        descriptionKey: "nav.chartBuilderDesc",
        path: "#/analytics/charts",
        view: "analytics-charts",
        icon: LineChart,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.heatmaps",
        descriptionKey: "nav.heatmapsDesc",
        path: "#/analytics/heatmaps",
        view: "analytics-heatmaps",
        icon: Grid3x3,
        phase: null,
        ready: true,
      },
    ],
  },
  {
    labelKey: "nav.groups.process",
    items: [
      {
        labelKey: "nav.journal",
        descriptionKey: "nav.journalDesc",
        path: "#/journal",
        view: "journal",
        icon: NotebookPen,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.strategies",
        descriptionKey: "nav.strategiesDesc",
        path: "#/strategies",
        view: "strategies",
        icon: Target,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.rules",
        descriptionKey: "nav.rulesDesc",
        path: "#/regles",
        view: "rules",
        icon: ListChecks,
        phase: null,
        ready: true,
      },
    ],
  },
  {
    labelKey: "nav.groups.reference",
    items: [
      {
        labelKey: "nav.accounts",
        descriptionKey: "nav.accountsDesc",
        path: "#/comptes",
        view: "accounts",
        icon: Wallet,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.instruments",
        descriptionKey: "nav.instrumentsDesc",
        path: "#/instruments",
        view: "instruments",
        icon: Coins,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.tags",
        descriptionKey: "nav.tagsDesc",
        path: "#/tags",
        view: "tags",
        icon: Tags,
        phase: null,
        ready: true,
      },
    ],
  },
  {
    labelKey: "nav.groups.app",
    items: [
      {
        labelKey: "nav.mentorSpace",
        descriptionKey: "nav.mentorSpaceDesc",
        path: "#/mentor",
        view: "mentor",
        icon: GraduationCap,
        phase: null,
        ready: true,
        mentorOnly: true,
      },
      {
        labelKey: "nav.tools",
        descriptionKey: "nav.toolsDesc",
        path: "#/outils",
        view: "tools",
        icon: Calculator,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.templates",
        descriptionKey: "nav.templatesDesc",
        path: "#/reglages/templates",
        view: "templates",
        icon: LayoutTemplate,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.brokerSync",
        descriptionKey: "nav.brokerSyncDesc",
        path: "#/reglages/broker-sync",
        view: "broker-sync",
        icon: Plug,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.import",
        descriptionKey: "nav.importDesc",
        path: "#/importer",
        view: "import",
        icon: Upload,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.reconciliation",
        descriptionKey: "nav.reconciliationDesc",
        path: "#/reconciliation",
        view: "reconciliation",
        icon: GitMerge,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.sharing",
        descriptionKey: "nav.sharingDesc",
        path: "#/reglages/partage",
        view: "sharing",
        icon: Link2,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.mentors",
        descriptionKey: "nav.mentorsDesc",
        path: "#/reglages/mentors",
        view: "mentors",
        icon: Users,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.trash",
        descriptionKey: "nav.trashDesc",
        path: "#/trash",
        view: "trash",
        icon: Trash2,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.account",
        descriptionKey: "nav.accountDesc",
        path: "#/reglages/compte",
        view: "account-settings",
        icon: ShieldCheck,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.dashboardsSettings",
        descriptionKey: "nav.dashboardsSettingsDesc",
        path: "#/reglages/dashboards",
        view: "dashboards-settings",
        icon: LayoutTemplate,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.appearance",
        descriptionKey: "nav.appearanceDesc",
        path: "#/reglages/appearance",
        view: "appearance-settings",
        icon: Palette,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.privacy",
        descriptionKey: "nav.privacyDesc",
        path: "#/reglages/privacy",
        view: "privacy-settings",
        icon: EyeOff,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.accessibility",
        descriptionKey: "nav.accessibilityDesc",
        path: "#/reglages/accessibility",
        view: "accessibility-settings",
        icon: Accessibility,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.settings",
        descriptionKey: "nav.settingsDesc",
        path: "#/reglages",
        view: "settings",
        icon: Settings,
        phase: null,
        ready: true,
      },
    ],
  },
];

export function findNavItem(view: ViewId): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.view === view);
    if (item) return item;
  }
  return undefined;
}
