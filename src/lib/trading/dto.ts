/**
 * Client-safe DTOs for the trade domain (API JSON shapes).
 *
 * Server mappers (src/server/*) convert Prisma rows into these plain objects:
 * decimals as exact STRINGS, dates as ISO strings — matching decimal.js and
 * the calculation engine inputs. No Prisma import here (client-bundled).
 */

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  kind: string;
  /** True for global presets (userId = null) - read-only in the UI. */
  isPreset?: boolean;
}

/** Custom instrument (user-owned) - presets have isPreset = true. */
export interface InstrumentDTO {
  id: string;
  /** True for global presets (userId = null) - read-only in the UI. */
  isPreset: boolean;
  symbol: string;
  name: string;
  assetClass: string;
  baseCurrency: string | null;
  quoteCurrency: string;
  digits: number;
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize: string | null;
  tickValue: string | null;
  isActive: boolean;
  /** Market timezone (IANA) for market-time display, null when unset. */
  marketTimezone: string | null;
}

export interface TradeListItemDTO {
  id: string;
  accountId: string;
  accountName: string;
  strategyId: string | null;
  strategyName: string | null;
  instrumentId: string;
  symbol: string;
  digits: number;
  direction: string;
  orderType: string;
  status: string;
  timeframe: string | null;
  session: string | null;
  setupType: string | null;
  entryTime: string;
  exitTime: string | null;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  lots: string;
  riskPercent: string | null;
  pips: string | null;
  netPnl: string | null;
  pnlCurrency: string;
  rMultiple: string | null;
  plannedRR: string | null;
  resultType: string | null;
  exitReason: string | null;
  reviewStatus: string;
  isDraft: boolean;
  emotionBefore: string | null;
  followedPlan: boolean | null;
  createdAt: string;
  updatedAt: string;
  tags: TagDTO[];
  /** User custom-field values, keyed by definition key (null when none). */
  customFields: Record<string, unknown> | null;
  /** Current price override (exposure dashboard), null = entry price. */
  currentPrice: string | null;
}

export interface ScreenshotDTO {
  id: string;
  label: string | null;
  caption: string | null;
  createdAt: string;
  url: string;
}

export interface ExecutionDTO {
  id: string;
  type: string;
  time: string;
  price: string;
  lots: string;
  commission: string;
  pnl: string | null;
}

export interface TradeDetailDTO extends TradeListItemDTO {
  marketCondition: string | null;
  mfePrice: string | null;
  maePrice: string | null;
  initialStopLoss: string | null;
  initialTakeProfit: string | null;
  riskAmount: string | null;
  commission: string;
  swap: string;
  fees: string;
  grossPnl: string | null;
  pnlSource: string;
  points: string | null;
  realizedRR: string | null;
  emotionDuring: string | null;
  emotionAfter: string | null;
  confidence: number | null;
  setupQualityRating: number | null;
  executionRating: number | null;
  lessonLearned: string | null;
  preTradeAnalysis: string;
  postTradeReview: string;
  notes: string | null;
  tradingViewUrl: string | null;
  checklistResults: Record<string, boolean> | null;
  accountCurrency: string;
  accountInitialBalance: string;
  /** Attached partial exit plan (null = none). */
  exitPlanId: string | null;
  /** Current price override (exposure dashboard), null = entry price. */
  currentPrice: string | null;
  screenshots: ScreenshotDTO[];
  executions: ExecutionDTO[];
  hasReview: boolean;
  // ── v2.5 Module 2 — price chart overlay sources ──
  /** SL/TP/volume modification history (moved-SL steps on the chart). */
  modifications: Array<{
    id: string;
    time: string;
    field: string; // STOP_LOSS | TAKE_PROFIT | VOLUME | OTHER
    oldValue: string | null;
    newValue: string | null;
    source: string;
  }>;
  /** Linked news events (markers on the chart). */
  newsEvents: Array<{
    id: string;
    title: string;
    time: string;
    importance: string; // LOW | MEDIUM | HIGH
  }>;
}

export interface TemplateDTO {
  id: string;
  name: string;
  strategyId: string | null;
  strategyName: string | null;
  instrumentId: string | null;
  symbol: string | null;
  direction: string | null;
  timeframe: string | null;
  session: string | null;
  orderType: string | null;
  defaultRiskPercent: string | null;
  defaultRiskAmount: string | null;
  defaultLots: string | null;
  defaultStopLossPips: string | null;
  defaultTakeProfitPips: string | null;
  defaultTagIds: string[];
  defaultChecklistItemIds: string[];
  prefilledNotes: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

export interface StrategyDTO {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  timeframes: string[];
  defaultRiskPercent: string | null;
  targetRR: string | null;
  entryRules: string | null;
  exitRules: string | null;
  riskRules: string | null;
  checklistItems: Array<{
    id: string;
    label: string;
    category: string;
    order: number;
    isRequired: boolean;
  }>;
  createdAt: string;
}

export interface AccountDTO {
  id: string;
  name: string;
  broker: string | null;
  type: string;
  currency: string;
  initialBalance: string;
  leverage: number | null;
  isActive: boolean;
  maxDailyLossPercent: string | null;
  maxTotalDrawdownPercent: string | null;
  profitTarget: string | null;
  drawdownType: string | null;
  startDate: string | null;
  /** Margin call level in % (null = broker default 100). */
  marginCallLevel: string | null;
  /** Stop-out level in % (null = broker default 50). */
  stopOutLevel: string | null;
  /** Broker server clock: IANA | FIXED_OFFSET | NY_CLOSE (v2.5 Module 8). */
  serverTimezoneMode: string;
  /** IANA zone when serverTimezoneMode = IANA. */
  serverTimezone: string | null;
  /** Fixed UTC offset in minutes when serverTimezoneMode = FIXED_OFFSET. */
  serverFixedOffsetMinutes: number | null;
  createdAt: string;
}

// ── v2.5 Module 5 — trading tools ────────────────────────────────────────────

export interface ToolScenarioDTO {
  id: string;
  name: string;
  /** MULTI_TP | MARGIN */
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FxRateDTO {
  id: string;
  base: string;
  quote: string;
  /** 1 base = rate quote (exact decimal as a string). */
  rate: string;
  source: string;
  /** ISO date the rate applies to. */
  date: string;
  createdAt: string;
}

export interface MarketSessionSettingDTO {
  id: string;
  name: string;
  kind: string;
  timezone: string;
  openTime: string;
  closeTime: string;
  /** ISO weekdays 1 = Monday ... 7 = Sunday. */
  activeDays: number[];
  enabled: boolean;
  sortOrder: number;
}

export interface ExitPlanDTO {
  id: string;
  name: string;
  tiers: import("@/lib/tools/types").ExitPlanTier[];
  breakevenAfterTier: number | null;
  trailingAfterTier: number | null;
  notes: string;
  createdAt: string;
}

export interface ExposureAlertSettingDTO {
  id: string;
  enabled: boolean;
  duplicationThresholdPercent: string;
  maxCurrencyExposurePercent: string;
}

export interface SavedViewDTO {
  id: string;
  page: string;
  name: string;
  filters: Record<string, unknown>;
  /** Visible column ids in order (null = table default). */
  columns: string[] | null;
  /** Sort state [{ id, desc }] (null = table default). */
  sort: Array<{ id: string; desc: boolean }> | null;
  /** Grouping state (null = none). */
  grouping: Record<string, unknown> | null;
  entity: string | null;
  isPinned: boolean;
  isDefault: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// ── v2.5 Module 4 — productivity ────────────────────────────────────────────

export type CustomFieldType =
  | "TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "DECIMAL"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "DATE"
  | "URL";

export interface CustomFieldDefinitionDTO {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: CustomFieldType;
  /** Select options (null when the type has none). */
  options: string[] | null;
  required: boolean;
  defaultValue: unknown;
  order: number;
  showInTable: boolean;
  showInQuickForm: boolean;
  usableInAnalytics: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface TableColumnPreferenceDTO {
  tableKey: string;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  density: string | null;
  updatedAt: string;
}

export interface ShortcutDTO {
  actionId: string;
  keys: string;
  /** True when no stored row exists (the default chord applies). */
  isDefault: boolean;
}

export interface SearchResultItemDTO {
  id: string;
  entity: "trade" | "strategy" | "journal";
  title: string;
  subtitle: string | null;
  snippet: string;
  href: string;
}

export interface SearchPayload {
  query: string;
  trades: SearchResultItemDTO[];
  strategies: SearchResultItemDTO[];
  journal: SearchResultItemDTO[];
  total: number;
}

/** One undoable action = one ChangeLog group (bulk edit or bulk delete). */
export interface ChangeLogGroupDTO {
  groupId: string;
  action: string;
  source: string;
  entity: string;
  /** Number of entries (trades) in the group. */
  count: number;
  createdAt: string;
  undoneAt: string | null;
  expiresAt: string;
  /** Human-readable summary, derived from the first entry's snapshots. */
  summary: {
    strategyId?: string | null;
    accountId?: string | null;
    tagIds?: string[];
    deleted?: boolean;
  };
}

export interface PaginatedDTO<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ── Dashboard payload (client-safe mirrors of server aggregates) ────────────

import type { TradeStats } from "@/lib/analytics/engine";

export type TradeStatsDTO = TradeStats;

export interface OpenPositionDTO {
  id: string;
  symbol: string;
  digits: number;
  direction: string;
  entryTime: string;
  entryPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  lots: string;
  riskAmount: string | null;
  riskPercent: string | null;
  pnlCurrency: string;
  accountName: string;
  accountId: string;
  strategyName: string | null;
  timeframe: string | null;
}

export interface DashboardPayload {
  currency: string;
  accounts: AccountDTO[];
  kpis30d: TradeStatsDTO | null;
  kpisAllTime: TradeStatsDTO | null;
  openPositions: OpenPositionDTO[];
  toReviewCount: number;
  draftCount: number;
  equityInitialBalance: string;
  equityCurve: Array<{
    i: number;
    date: string;
    equity: string;
    cumPnl: string;
    drawdown: string;
  }>;
  strategyStats: Array<{
    key: string;
    name: string;
    color: string;
    stats: TradeStatsDTO;
  }>;
  recentTrades: TradeListItemDTO[];
}

// ── Analytics payload (v2 Phase 4) ───────────────────────────────────────────

import type {
  AdvancedStats,
  Breakdowns,
  Insight,
  RDistBucket,
} from "@/lib/analytics/insights";
import type { EquityPoint } from "@/lib/analytics/engine";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";

export interface AnalyticsPayload {
  period: AnalyticsPeriod;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  stats: TradeStatsDTO | null;
  advanced: AdvancedStats | null;
  equityInitialBalance: string;
  equityCurve: EquityPoint[];
  rDistribution: { buckets: RDistBucket[]; withoutR: number };
  breakdowns: Breakdowns;
  insights: Insight[];
}

// ── Advanced analytics payload (v2.5 Module 6) ─────────────────────────────

import type { AdvancedAnalytics } from "@/lib/analytics/advanced";

export interface AdvancedAnalyticsPayload {
  period: AnalyticsPeriod;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  advanced: AdvancedAnalytics;
}

// ── Journal & calendar (v1 Phase 5) ─────────────────────────────────────────

export interface JournalEntryDTO {
  id: string;
  /** Local calendar day YYYY-MM-DD (user's timezone). */
  date: string;
  preMarketPlan: string | null;
  postMarketReview: string | null;
  mood: number | null;
  sleepQuality: number | null;
  disciplineScore: number | null;
  keyLesson: string | null;
  marketBias: string | null;
  updatedAt: string;
}

export interface CalendarPayload {
  year: number;
  month: number;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  /** Monday-first grid: 4-6 weeks × 7 cells (ISO dates, in-month flag). */
  grid: Array<Array<{ date: string; inMonth: boolean }>>;
  days: Record<string, {
    netPnl: string;
    tradeCount: number;
    wins: number;
    losses: number;
    totalR: string | null;
    hasJournal: boolean;
  }>;
  summary: {
    netPnl: string;
    tradingDays: number;
    greenDays: number;
    redDays: number;
    bestDay: { date: string; netPnl: string } | null;
    worstDay: { date: string; netPnl: string } | null;
    greenRate: string | null;
  };
  streaks: {
    current: number;
    longestWin: number;
    longestLoss: number;
  };
}

// ── Strategy versions & stats (v1 Phase 5) ──────────────────────────────────

export interface StrategyVersionDTO {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  /** Parsed snapshot: the strategy + checklist as saved. */
  snapshot: {
    name: string;
    description: string | null;
    color: string;
    status: string;
    timeframes: string[];
    defaultRiskPercent: string | null;
    targetRR: string | null;
    entryRules: string | null;
    exitRules: string | null;
    riskRules: string | null;
    checklistItems: Array<{
      label: string;
      category: string;
      order: number;
      isRequired: boolean;
    }>;
  };
}

export interface StrategyStatsDTO {
  key: string;
  name: string;
  color: string;
  status: string;
  stats: TradeStatsDTO;
}

export interface StrategyDetailPayload {
  strategy: StrategyDTO;
  versions: StrategyVersionDTO[];
  stats: StrategyStatsDTO | null;
}

// ── PROP challenge status (v1 Phase 5) ──────────────────────────────────────

import type { PropStatus } from "@/lib/analytics/calendar";

export type PropStatusDTO = PropStatus;

export interface PropStatusPayload {
  account: AccountDTO;
  status: PropStatusDTO | null;
}

// ── Goals & rules (v1 Phase 6) ──────────────────────────────────────────────

import type { GoalProgress } from "@/lib/trading/goals";

export interface RuleDTO {
  id: string;
  kind: string; // RULE_KINDS
  value: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface GoalDTO {
  id: string;
  name: string;
  description: string | null;
  metric: string; // GOAL_METRICS
  targetValue: string;
  period: string; // GOAL_PERIODS
  /** Local calendar day YYYY-MM-DD. */
  startDate: string;
  endDate: string | null;
  status: string; // ACTIVE | PAUSED (ACHIEVED/MISSED are computed live)
  createdAt: string;
}

export interface GoalWithProgressDTO extends GoalDTO {
  progress: GoalProgress;
}

export interface GoalsPayload {
  goals: GoalWithProgressDTO[];
  timezone: string;
}

export interface RuleViolationDTO {
  tradeId: string;
  ruleId: string;
  kind: string; // RULE_KINDS (CUSTOM never fires)
  /** Machine-readable detail for i18n display. */
  measured: string;
  limit: string;
  description: string | null;
  createdAt: string;
  /** Flattened trade context for list rows. */
  trade: {
    symbol: string;
    direction: string;
    entryTime: string;
    exitTime: string | null;
    netPnl: string | null;
    isDraft: boolean;
  } | null;
}
