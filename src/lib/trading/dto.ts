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
  /** Playbook setup used (null = free-text setupType only, or none). */
  setupId: string | null;
  /** Strategy definition version frozen at entry (null = before Playbook). */
  strategyVersion: number | null;
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
  /** MRT setup grade (A+ | A | B | C), null = ungraded. */
  grade: string | null;
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
  /** Playbook match declared at review time (null = not declared). */
  playbookMatch: string | null;
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
  instruments: string[];
  sessions: string[];
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
  /** Playbook (Phase 2) — definition revision, bumped on definition edits. */
  version: number;
  /** Presentation grade (A+ | A | B | C), no version bump. */
  grade: string | null;
  detailedDescription: string | null;
  tags: string[];
  marketProfile: PlaybookMarketProfile | null;
  marketConditions: string[];
  entryConditions: PlaybookEntryCondition[];
  confirmations: PlaybookConfirmation[];
  invalidations: string[];
  risk: PlaybookRisk | null;
  tradeManagement: PlaybookManagementRule[];
  exitPlan: PlaybookExitRule[];
  /** Attached setups (Playbook page; empty on the selector list). */
  setups?: SetupDTO[];
  /** Open-trade warning on delete: trades still attached. */
  tradeCount?: number;
}

export interface PlaybookMarketProfile {
  assetClass: string | null;
  symbols: string[];
  market: string | null;
  accountLabel: string | null;
  timeframe: string | null;
  tradingStyle: string | null;
  sessions: string[];
  tradingDays: string[];
}

export interface PlaybookEntryCondition {
  id: string;
  category: string;
  text: string;
  group: string | null;
}

export interface PlaybookConfirmation {
  id: string;
  type: string;
  note: string | null;
}

export interface PlaybookManagementRule {
  id: string;
  trigger: string;
  action: string;
  condition: string | null;
}

export interface PlaybookExitRule {
  id: string;
  type: string;
  rule: string;
}

export interface PlaybookRisk {
  defaultRiskPct: number | null;
  maxRiskPct: number | null;
  fixedRiskAmount: string | null;
  stopMethodology: string | null;
  targetMethodology: string | null;
  minRR: number | null;
  maxConcurrentTrades: number | null;
  maxCorrelatedExposure: number | null;
  dailyRiskRestriction: string | null;
  newsRestriction: string | null;
}

export interface SetupDTO {
  id: string;
  strategyId: string;
  strategyName: string | null;
  name: string;
  description: string | null;
  status: string;
  context: string | null;
  marketCondition: string | null;
  trigger: string | null;
  confirmation: string | null;
  entryModel: string | null;
  stopModel: string | null;
  targetModel: string | null;
  invalidation: string;
  notes: string | null;
  tags: string[];
  tradeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookRuleDTO {
  id: string;
  title: string;
  detail: string;
  category: string;
  scope: string;
  strategyId: string | null;
  strategyName: string | null;
  evaluatable: boolean;
  evaluationHint: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTemplateDTO {
  id: string;
  strategyId: string | null;
  strategyName: string | null;
  name: string;
  items: Array<{ label: string; required: boolean; category: string }>;
  createdAt: string;
  updatedAt: string;
}

export type StrategyHealthFlag =
  | "DRAFT"
  | "ARCHIVED"
  | "NO_RECENT_TRADES"
  | "MISSING_RISK"
  | "MISSING_ENTRY_CONDITIONS"
  | "MISSING_INVALIDATION"
  | "MISSING_CHECKLIST";

export interface StrategyHealthDTO {
  strategyId: string;
  flags: StrategyHealthFlag[];
}

export interface PlaybookComplianceDTO {
  windowSize: number;
  reviewed: number;
  matched: number;
  partial: number;
  offPlaybook: number;
  unreviewed: number;
  /** matched / reviewed x 100, null when nothing was reviewed. */
  scorePct: number | null;
}

export interface PlaybookOverviewDTO {
  counts: {
    totalStrategies: number;
    active: number;
    draft: number;
    paused: number;
    archived: number;
    testing: number;
    totalSetups: number;
    totalRules: number;
    totalChecklists: number;
  };
  recentlyUpdated: Array<{
    strategyId: string;
    name: string;
    status: string;
    color: string;
    version: number;
    updatedAt: string;
  }>;
  recentlyUsed: Array<{
    strategyId: string;
    name: string;
    color: string;
    lastTradeAt: string | null;
    tradesCount: number;
  }>;
  compliance: PlaybookComplianceDTO;
  health: StrategyHealthDTO[];
  /** Worst strategy by expectancy over the last 20 closed trades, when it is
   *  negative with n >= 5 — the underperformance banner source. */
  underperforming: {
    strategyId: string;
    name: string;
    expectancyR20: string;
    trades20: number;
  } | null;
}

export interface SetupInsightDTO {
  setupId: string;
  strategyId: string;
  setupName: string;
  windowDays: 90;
  trades: number;
  wins: number;
  winRatePct: number | null;
  totalR: number | null;
  expectancyR: number | null;
  topInstrument: string | null;
  topInstrumentId: string | null;
  topSession: string | null;
  smallSample: boolean;
}

export interface PlaybookTemplateCardDTO {
  key: string;
  name: string;
  description: string;
  tradingStyle: string;
  marketConditions: string[];
  tags: string[];
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

// ── Account health badges (MRT wave 2, chantier 4) ─────────────────────────

/** Health of one account, computed from its real closed trades. */
export interface AccountHealthDTO {
  accountId: string;
  currency: string;
  /** growing | stable | in-drawdown | no-data (no closed trade yet). */
  status: "growing" | "stable" | "in-drawdown" | "no-data";
  /** Current drawdown from the peak, account currency, always >= 0. */
  drawdown: string;
  /** Current drawdown as % of the peak, null when the peak is not positive. */
  drawdownPercent: number | null;
  /** Share of the allowed max drawdown used, null when no limit is set. */
  drawdownUsagePercent: number | null;
  /** Net P&L since the start (current equity - initial balance). */
  netPnl: string;
  /** Closed trades behind the figures. */
  tradeCount: number;
  /** Exit time of the most recent closed trade, ISO, null when none. */
  lastTradeAt: string | null;
}

export interface AccountsHealthPayload {
  health: AccountHealthDTO[];
}

// ── v2.5 Module 5 — trading tools ────────────────────────────────────────────

export interface ToolScenarioDTO {
  id: string;
  name: string;
  /** MULTI_TP | MARGIN | RISK_REWARD */
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ── Risk / Reward summary (Phase 2) ──────────────────────────────────────────

/** Real stats from the user's own closed trades — never invented. */
export interface RiskRewardRealStats {
  /** Closed non-draft trades with a known result. */
  closedTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** Fraction 0–1, null when no closed trade. */
  winRate: string | null;
  /** Mean realized R, null when no trade carries one. */
  avgRealizedRR: string | null;
  /** Mean planned R:R, null when no trade carries one. */
  avgPlannedRR: string | null;
  /** Mean net P&L per closed trade, account currency. */
  expectancyMoney: string | null;
  /** Mean R multiple per closed trade. */
  expectancyR: string | null;
  /** Mean winning trade, account currency (positive). */
  avgWin: string | null;
  /** Mean losing trade magnitude, account currency (positive). */
  avgLoss: string | null;
}

export interface RiskRewardSummaryDTO {
  currency: string;
  /** Trading day (YYYY-MM-DD) the budget figures refer to. */
  tradingDay: string;
  /** Current balance = starting balances + realized P&L + cash flows. */
  balance: string;
  budget: {
    /** Daily risk budget as % of balance, null when not set. */
    percent: string | null;
    /** Daily risk budget in account currency, null when not set. */
    amount: string | null;
    isSet: boolean;
  };
  today: {
    /** Open trades whose risk is still live. */
    openTrades: number;
    /** Σ riskAmount of open trades (account currency). */
    openRisk: string;
    /** Realized losses of the trading day, as a positive amount. */
    realizedLossToday: string;
    /** Net P&L of the trading day (signed). */
    realizedPnlToday: string;
    /** Consumed budget = open risk + realized losses of the day. */
    consumed: string;
    /** Remaining budget, null when no budget is set. */
    remaining: string | null;
    /** Consumed share of the budget (0–1+), null when no budget is set. */
    usedPercent: number | null;
  };
  realStats: RiskRewardRealStats;
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

/**
 * Persisted anomaly flag for one trade (a TradeAnomaly row, written by the
 * advanced analytics computation). Served joined to the trades list so the
 * badge column needs no full analytics recalculation per visit.
 */
export interface TradeAnomalyFlagDTO {
  tradeId: string;
  kind: string;
  severity: string;
  zScore: number;
}

/** Trades list payload: page rows + persisted anomaly flags for those rows. */
export type TradesListPayload = PaginatedDTO<TradeListItemDTO> & {
  anomalies: TradeAnomalyFlagDTO[];
};

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
  /** Closed trades excluded because their stored P&L currency differs from currency. */
  excludedTradeCount: number;
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
  /** Closed trades excluded because their account currency differs from currency. */
  excludedTradeCount: number;
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

// ── Weekly improvement plan (MRT wave 1) ───────────────────────────────────

import type { WeeklyPlan } from "@/lib/analytics/weekly-plan";

// ── Performance report (MRT wave 3) ──────────────────────────────────────

import type { PerformanceReport } from "@/lib/analytics/performance-report";

// ── When you trade (MRT wave 2) ─────────────────────────────────────────────

import type { WhenYouTradeResult } from "@/lib/analytics/when-you-trade";

export interface WhenYouTradePayload extends WhenYouTradeResult {
  period: AnalyticsPeriod;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
}

export interface WeeklyPlanPayload {
  /** Monday of the week the plan covers, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday of that week, YYYY-MM-DD. */
  weekEnd: string;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  plan: WeeklyPlan;
}

/** Performance report (MRT wave 3) — verdict, weekly P&L, edge sources. */
export interface PerformanceReportPayload {
  period: AnalyticsPeriod;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  report: PerformanceReport;
  /**
   * Phase 2 perf — the standard 30d weekly plan, embedded so the page
   * needs no second GET /api/weekly-plan (same computation at 30d).
   */
  plan: WeeklyPlan;
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

/**
 * One trading day, for the calendar day-detail panel (MRT wave 2).
 * Trades are the CLOSED trades whose TRADING day (exit, user setting) is
 * `date` — the same bucketing as the month grid, so the panel totals match
 * the grid cell. The journal entry is fetched separately (useJournalEntry).
 */
export interface CalendarDayPayload {
  /** Trading day YYYY-MM-DD. */
  date: string;
  /** Active account filter (null = all accounts). */
  accountId: string | null;
  currency: string;
  timezone: string;
  /** Closed trades of the day, newest exit first. */
  trades: TradeListItemDTO[];
  /** Day totals over `trades` (same math as the month grid). */
  netPnl: string;
  tradeCount: number;
  wins: number;
  losses: number;
  /** Sum of R multiples over R-trades (null when none has an R). */
  totalR: string | null;
}

// ── Strategy versions & stats (v1 Phase 5) ──────────────────────────────────

export interface StrategyVersionDTO {
  id: string;
  version: number;
  note: string | null;
  /** MANUAL = saved by hand; AUTO = frozen before a definition edit. */
  origin: string;
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
    /** Strategy definition version frozen in this snapshot. */
    strategyVersion: number;
  };
}

export interface StrategyStatsDTO {
  key: string;
  name: string;
  color: string;
  status: string;
  stats: TradeStatsDTO;
  /** Cumulative R curve (oldest first, max 60 points) for the sparkline. */
  sparklineR: number[];
  /** Expectancy over the last 20 closed trades (null when none). */
  expectancyR20: string | null;
  /** Trades counted in expectancyR20. */
  trades20: number;
  /** Worst strategy with expectancyR20 < 0 and trades20 >= 5. */
  underperforming: boolean;
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
