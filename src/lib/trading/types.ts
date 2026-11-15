/**
 * Domain types + French UI labels.
 * SQLite has no enums: values are strings validated with these constants (Zod at the edge).
 */
import type { DecimalInput } from "./dec";

export type Direction = "LONG" | "SHORT";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type TradeStatus = "OPEN" | "CLOSED" | "PENDING" | "CANCELLED";
export type TradingSession = "ASIAN" | "LONDON" | "NEW_YORK" | "OVERLAP" | "OTHER";
export type ResultType = "WIN" | "LOSS" | "BREAKEVEN";
export type PnlSource = "CALCULATED" | "MANUAL";
export type ExitReason =
  | "TP_HIT"
  | "SL_HIT"
  | "MANUAL"
  | "TRAILING"
  | "TIME"
  | "BREAKEVEN_STOP"
  | "PARTIAL"
  | "OTHER";
export type AssetClass =
  | "FOREX"
  | "METAL"
  | "INDEX"
  | "CRYPTO"
  | "STOCK"
  | "COMMODITY"
  | "FUTURES";
export type Emotion =
  | "CALM"
  | "CONFIDENT"
  | "FOCUSED"
  | "ANXIOUS"
  | "FEARFUL"
  | "GREEDY"
  | "FOMO"
  | "REVENGE"
  | "BORED"
  | "FRUSTRATED"
  | "EUPHORIC"
  | "TIRED";
export type MarketCondition = "TRENDING" | "RANGING" | "VOLATILE" | "NEWS" | "OTHER";
export type ExecutionType = "ENTRY" | "ADD" | "PARTIAL_EXIT" | "FINAL_EXIT";
export type AccountType = "LIVE" | "DEMO" | "PROP" | "BACKTEST";
export type CashTransactionType = "DEPOSIT" | "WITHDRAWAL" | "BONUS" | "ADJUSTMENT";
export type StrategyStatus = "ACTIVE" | "TESTING" | "ARCHIVED";
export type ChecklistCategory = "ENTRY" | "EXIT" | "RISK" | "CONTEXT";
export type TagKind = "SETUP" | "MISTAKE" | "CONTEXT" | "CUSTOM";
export type ScreenshotLabel = "BEFORE" | "ENTRY" | "EXIT" | "AFTER";
export type RuleKind =
  | "MAX_TRADES_PER_DAY"
  | "MAX_DAILY_LOSS"
  | "MAX_RISK_PER_TRADE"
  | "CUSTOM";
export type ReviewStatus = "NOT_REVIEWED" | "REVIEWED";
export type DrawdownType = "STATIC" | "TRAILING";
export type GoalMetric =
  | "NET_PNL"
  | "WIN_RATE"
  | "AVG_R"
  | "PROFIT_FACTOR"
  | "TRADE_COUNT"
  | "DISCIPLINE_SCORE";
export type GoalPeriod =
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY"
  | "ALL_TIME";
export type GoalStatus = "ACTIVE" | "ACHIEVED" | "MISSED" | "PAUSED";

/** Minimal instrument shape needed by the calculation engine (client-safe). */
export interface InstrumentSpec {
  id?: string;
  symbol: string;
  name: string;
  assetClass: AssetClass | string;
  baseCurrency: string | null;
  quoteCurrency: string;
  digits: number;
  pipSize: DecimalInput;
  pointSize: DecimalInput;
  contractSize: DecimalInput;
  tickSize?: DecimalInput | null;
  tickValue?: DecimalInput | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const DIRECTIONS: readonly Direction[] = ["LONG", "SHORT"];
export const ORDER_TYPES: readonly OrderType[] = ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"];
export const TRADE_STATUSES: readonly TradeStatus[] = ["OPEN", "CLOSED", "PENDING", "CANCELLED"];
export const TRADING_SESSIONS: readonly TradingSession[] = [
  "ASIAN",
  "LONDON",
  "OVERLAP",
  "NEW_YORK",
  "OTHER",
];
export const RESULT_TYPES: readonly ResultType[] = ["WIN", "LOSS", "BREAKEVEN"];
export const EXIT_REASONS: readonly ExitReason[] = [
  "TP_HIT",
  "SL_HIT",
  "MANUAL",
  "TRAILING",
  "TIME",
  "BREAKEVEN_STOP",
  "PARTIAL",
  "OTHER",
];
export const ASSET_CLASSES: readonly AssetClass[] = [
  "FOREX",
  "METAL",
  "INDEX",
  "CRYPTO",
  "STOCK",
  "COMMODITY",
  "FUTURES",
];
export const EMOTIONS: readonly Emotion[] = [
  "CALM",
  "CONFIDENT",
  "FOCUSED",
  "ANXIOUS",
  "FEARFUL",
  "GREEDY",
  "FOMO",
  "REVENGE",
  "BORED",
  "FRUSTRATED",
  "EUPHORIC",
  "TIRED",
];
export const MARKET_CONDITIONS: readonly MarketCondition[] = [
  "TRENDING",
  "RANGING",
  "VOLATILE",
  "NEWS",
  "OTHER",
];
export const EXECUTION_TYPES: readonly ExecutionType[] = [
  "ENTRY",
  "ADD",
  "PARTIAL_EXIT",
  "FINAL_EXIT",
];
export const ACCOUNT_TYPES: readonly AccountType[] = ["LIVE", "DEMO", "PROP", "BACKTEST"];
export const CASH_TRANSACTION_TYPES: readonly CashTransactionType[] = [
  "DEPOSIT",
  "WITHDRAWAL",
  "BONUS",
  "ADJUSTMENT",
];
export const STRATEGY_STATUSES: readonly StrategyStatus[] = ["ACTIVE", "TESTING", "ARCHIVED"];
export const CHECKLIST_CATEGORIES: readonly ChecklistCategory[] = ["ENTRY", "EXIT", "RISK", "CONTEXT"];
export const TAG_KINDS: readonly TagKind[] = ["SETUP", "MISTAKE", "CONTEXT", "CUSTOM"];
export const SCREENSHOT_LABELS: readonly ScreenshotLabel[] = ["BEFORE", "ENTRY", "EXIT", "AFTER"];
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["NOT_REVIEWED", "REVIEWED"];
export const DRAWDOWN_TYPES: readonly DrawdownType[] = ["STATIC", "TRAILING"];
export const GOAL_METRICS: readonly GoalMetric[] = [
  "NET_PNL",
  "WIN_RATE",
  "AVG_R",
  "PROFIT_FACTOR",
  "TRADE_COUNT",
  "DISCIPLINE_SCORE",
];
export const GOAL_PERIODS: readonly GoalPeriod[] = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "ALL_TIME",
];
export const GOAL_STATUSES: readonly GoalStatus[] = [
  "ACTIVE",
  "ACHIEVED",
  "MISSED",
  "PAUSED",
];

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "CHF",
  "AUD",
  "NZD",
  "JPY",
] as const;

// ── Labels ──────────────────────────────────────────────────────────────────
// UI labels live in messages/fr.json + messages/en.json (namespace `trading`),
// resolved with next-intl: t(`trading.<kind>.<VALUE>`). The exported constants
// above (DIRECTIONS, ASSET_CLASSES, …) remain the single source of truth for
// the value sets themselves.
