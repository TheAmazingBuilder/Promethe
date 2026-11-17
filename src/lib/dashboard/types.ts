/**
 * Dashboard module — shared client-safe types (v2.5 Module 1).
 *
 * Pure types + constants only: no Prisma, no server imports. The registry,
 * period resolver, layout normalizer, templates and the UI all build on
 * these shapes; the server layer persists them as validated JSON.
 */

// ── Widgets ──────────────────────────────────────────────────────────────────

/** Every widget type the registry knows (unknown types render a placeholder). */
export const WIDGET_TYPES = [
  "kpi-strip",
  "single-kpi",
  "equity-curve",
  "drawdown-curve",
  "pnl-calendar",
  "open-trades",
  "recent-trades",
  "session-performance",
  "weekday-performance",
  "hour-performance",
  "strategy-table",
  "instrument-table",
  "r-histogram",
  "win-loss",
  "streak",
  "goals-progress",
  "journal-prompt",
  "review-queue",
  "next-news",
  "prop-status",
  "sync-status",
  "quick-actions",
  "sticky-note",
  "custom-metric",
  "period-compare",
  // v2.5 Module 2 — chart widgets
  "saved-chart",
  "heatmap",
  "year-calendar",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** Grid column count (desktop/tablet). */
export const GRID_COLS = 12;

/** react-grid-layout breakpoints, tuned for the CONTAINER (viewport minus
 *  sidebar + padding ≈ viewport − 300px): lg full grid, md/sm narrower. */
export const GRID_BREAKPOINTS = { lg: 780, md: 560, sm: 460 } as const;

export type Breakpoint = keyof typeof GRID_BREAKPOINTS;

export const BREAKPOINTS: readonly Breakpoint[] = ["lg", "md", "sm"];

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Partial map - missing breakpoints are filled by normalizeLayouts(). */
export type WidgetLayouts = Partial<Record<Breakpoint, WidgetLayout>>;

/** Layout JSON schema version (migration hook - see layout.ts). */
export const LAYOUT_SCHEMA_VERSION = 1;

// ── Periods ──────────────────────────────────────────────────────────────────

export type PeriodMode =
  | "INHERIT"
  | "PRESET"
  | "ROLLING_DAYS"
  | "ROLLING_TRADES"
  | "CUSTOM";

export type PeriodPreset =
  | "today"
  | "week"
  | "month"
  | "last30"
  | "last90"
  | "ytd"
  | "all";

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "today",
  "week",
  "month",
  "last30",
  "last90",
  "ytd",
  "all",
];

export function isPeriodPreset(value: string): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

/** Per-widget period override - null / mode INHERIT uses the global filter. */
export interface PeriodOverride {
  mode: PeriodMode;
  preset?: PeriodPreset;
  /** 1-365 (ROLLING_DAYS). */
  rollingDays?: number;
  /** 1-1000 (ROLLING_TRADES). */
  rollingTrades?: number;
  /** Local calendar days YYYY-MM-DD (CUSTOM). */
  customFrom?: string;
  customTo?: string;
  compareToPrevious?: boolean;
}

/**
 * Resolved period — what loaders actually consume. `from` is an ISO
 * lower bound (inclusive); `lastTrades` keeps the N most recent trades
 * (rolling trades mode).
 */
export interface ResolvedPeriod {
  /** ISO lower bound (inclusive) - null = all time. */
  from: string | null;
  /** Keep only the N most recent trades - null = unlimited. */
  lastTrades: number | null;
  /** ISO lower bound of the comparison period (compareToPrevious). */
  compareFrom: string | null;
  /** i18n key suffix under "dashboard.periods" for the header chip. */
  labelKey: string;
}

/** Global dashboard filter (URL state) - applies unless a widget overrides. */
export interface GlobalFilter {
  preset: PeriodPreset;
  accountId: string | null;
}

// ── KPI catalog ──────────────────────────────────────────────────────────────

/** Keys of the KPI catalog (kpi-strip / single-kpi widgets). */
export const KPI_KEYS = [
  "netPnl",
  "grossWin",
  "grossLoss",
  "winRate",
  "profitFactor",
  "expectancyR",
  "expectancyCurrency",
  "avgR",
  "totalR",
  "avgWin",
  "avgLoss",
  "payoffRatio",
  "tradeCount",
  "maxDrawdown",
  "currentDrawdown",
  "currentStreak",
  "bestTrade",
  "worstTrade",
  "avgDurationMin",
  "sqn",
  "totalPips",
  "totalFees",
  "avgRiskPercent",
  "reviewedPercent",
  "tradingDays",
] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

export function isKpiKey(value: string): value is KpiKey {
  return (KPI_KEYS as readonly string[]).includes(value);
}

/** Max KPIs in one strip (spec §4.5). */
export const KPI_STRIP_MAX = 8;

/** Value format for KPIs / custom metrics. */
export type MetricFormat =
  | "NUMBER"
  | "CURRENCY"
  | "PERCENT"
  | "R"
  | "PIPS"
  | "DURATION";

// ── Widget instance (API shape) ──────────────────────────────────────────────

export interface DashboardWidgetDTO {
  id: string;
  type: string;
  title: string | null;
  config: unknown;
  layouts: WidgetLayouts;
  periodOverride: PeriodOverride | null;
  accountOverride: string | null;
}

export interface DashboardDTO {
  id: string;
  name: string;
  icon: string;
  order: number;
  isDefault: boolean;
  templateKey: string | null;
  widgets: DashboardWidgetDTO[];
}

// ── Limits ───────────────────────────────────────────────────────────────────

export const MAX_DASHBOARDS = 8;
export const MAX_WIDGETS_PER_DASHBOARD = 24;
