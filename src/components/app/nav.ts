/**
 * Application navigation — single source of truth for the sidebar, the mobile
 * sheet, the command palette and the header title. Labels and descriptions are
 * absolute i18n message keys (see messages/en.json).
 *
 * Sidebar kept short on purpose: only the pages used every day live here
 * (10 entries at a glance, plus the collapsible Data group). Settings
 * sub-pages live as links inside the Settings page, charts and heatmaps as
 * buttons inside Analytics, quick trade as a floating button, and focus
 * mode as a header button.
 *
 * Strategies has no sidebar entry on purpose: the Playbook already has a
 * Strategies tab, so it would be a duplicate. The standalone Strategies
 * view (full editor: definition, checklists, versions, stats) stays a real
 * route, listed in EXTRA_NAV_ITEMS below so the command palette, search
 * and the header title keep finding it.
 *
 * The Data group is the one exception to the flat list: it renders as a
 * single collapsible parent row ("Data", collapsed by default) whose six
 * pages (Accounts, Instruments, Tags, Import, Broker Sync,
 * Reconciliation) appear as sub-entries when expanded. The pages are real
 * routes either way: `allNavItems()` still lists all of them, so the
 * command palette and the mobile sheet keep every page reachable.
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  CandlestickChart,
  Coins,
  Database,
  GitMerge,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  NotebookText,
  Plug,
  Settings,
  Tags,
  Target,
  Upload,
  UserRound,
  Wallet,
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
  /**
   * Renders as one collapsible parent row (label + chevron) instead of a
   * flat list. The group's items become sub-entries shown when expanded.
   */
  collapsible?: boolean;
  /** Icon for the collapsible parent row. */
  icon?: LucideIcon;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.groups.tracking",
    items: [
      {
        labelKey: "nav.dashboard",
        descriptionKey: "nav.dashboardDesc",
        path: "/",
        view: "dashboard",
        icon: LayoutDashboard,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.trades",
        descriptionKey: "nav.tradesDesc",
        path: "/trades",
        view: "trades",
        icon: CandlestickChart,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.calendar",
        descriptionKey: "nav.calendarDesc",
        path: "/calendar",
        view: "calendar",
        icon: CalendarDays,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.tools",
        descriptionKey: "nav.toolsDesc",
        path: "/tools",
        view: "tools",
        icon: Calculator,
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
        path: "/analytics",
        view: "analytics",
        icon: BarChart3,
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
        path: "/journal",
        view: "journal",
        icon: NotebookPen,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.playbook",
        descriptionKey: "nav.playbookDesc",
        path: "/playbook",
        view: "playbook",
        icon: BookOpen,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.gaia",
        descriptionKey: "nav.gaiaDesc",
        path: "/gaia",
        view: "gaia",
        icon: NotebookText,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.rules",
        descriptionKey: "nav.rulesDesc",
        path: "/rules",
        view: "rules",
        icon: ListChecks,
        phase: null,
        ready: true,
      },
    ],
  },
  {
    labelKey: "nav.groups.data",
    collapsible: true,
    icon: Database,
    items: [
      {
        labelKey: "nav.accounts",
        descriptionKey: "nav.accountsDesc",
        path: "/accounts",
        view: "accounts",
        icon: Wallet,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.instruments",
        descriptionKey: "nav.instrumentsDesc",
        path: "/instruments",
        view: "instruments",
        icon: Coins,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.tags",
        descriptionKey: "nav.tagsDesc",
        path: "/tags",
        view: "tags",
        icon: Tags,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.import",
        descriptionKey: "nav.importDesc",
        path: "/import",
        view: "import",
        icon: Upload,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.brokerSync",
        descriptionKey: "nav.brokerSyncDesc",
        path: "/broker-sync",
        view: "broker-sync",
        icon: Plug,
        phase: null,
        ready: true,
      },
      {
        labelKey: "nav.reconciliation",
        descriptionKey: "nav.reconciliationDesc",
        path: "/reconciliation",
        view: "reconciliation",
        icon: GitMerge,
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
        path: "/mentor",
        view: "mentor",
        icon: GraduationCap,
        phase: null,
        ready: true,
        mentorOnly: true,
      },
      {
        labelKey: "nav.settings",
        descriptionKey: "nav.settingsDesc",
        path: "/settings",
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
  return EXTRA_NAV_ITEMS.find((i) => i.view === view);
}

/**
 * Pages with no sidebar entry that stay reachable everywhere else:
 * Strategies lives in the Playbook tab (duplicating it in the sidebar
 * would be noise), but the standalone view is still a real route — the
 * command palette, search results and the header title resolve it here.
 */
export const EXTRA_NAV_ITEMS: NavItem[] = [
  {
    labelKey: "nav.strategies",
    descriptionKey: "nav.strategiesDesc",
    path: "/strategies",
    view: "strategies",
    icon: Target,
    phase: null,
    ready: true,
  },
  {
    labelKey: "nav.profile",
    descriptionKey: "nav.profileDesc",
    path: "/settings/profile",
    view: "profile-settings",
    icon: UserRound,
    phase: null,
    ready: true,
  },
];

/**
 * Every page in the app, in sidebar order — the single list the command
 * palette (and any full-page index) reads, so a page that is only a
 * sub-entry in the sidebar is still listed everywhere else. Palette-only
 * pages (EXTRA_NAV_ITEMS) come last.
 */
export function allNavItems(): NavItem[] {
  return [
    ...NAV_GROUPS.flatMap((group) => group.items),
    ...EXTRA_NAV_ITEMS,
  ];
}

/**
 * Collapsible group expansion rule: a stored collapse never hides the
 * page the user is on — when a sub-entry is active, its parent group
 * auto-expands even if the user left it collapsed.
 */
export function isGroupExpanded(
  storedCollapsed: boolean,
  hasActiveChild: boolean
): boolean {
  return !storedCollapsed || hasActiveChild;
}
