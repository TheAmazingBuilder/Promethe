/**
 * Client-side mirrors of the widget data payloads produced by
 * src/server/dashboard-data.ts (the server module itself imports Prisma and
 * cannot be referenced from client components). Shapes are kept in sync —
 * every renderer also tolerates null / malformed data.
 */
import type { EquityPoint, GroupStat, TradeStats } from "@/lib/analytics/engine";
import type { AdvancedStats, RDistBucket } from "@/lib/analytics/insights";
import type { MonthSummary } from "@/lib/analytics/calendar";
import type { OpenPositionDTO, TradeListItemDTO } from "@/lib/trading/dto";

// ── KPI widgets (kpi-strip, single-kpi, period-compare) ──────────────────────

export interface KpiExtras {
  totalPips: string | null;
  avgRiskPercent: string | null;
  reviewedPercent: string | null;
  currentDrawdown: string;
  bestTrade: string | null;
  worstTrade: string | null;
  tradingDays: number;
}

export interface KpiBlock {
  stats: TradeStats;
  advanced: AdvancedStats;
  extras: KpiExtras;
}

export interface KpiWidgetData extends KpiBlock {
  compare: KpiBlock | null;
  /** Cumulative net P&L per trade, chronological (may be absent in older payloads). */
  sparkline?: string[] | null;
}

// ── Curves ───────────────────────────────────────────────────────────────────

export interface CurveWidgetData {
  curve: EquityPoint[];
  initialBalance: string;
}

// ── P&L calendar ─────────────────────────────────────────────────────────────

export interface CalendarCellDTO {
  date: string;
  inMonth: boolean;
  netPnl: string;
  tradeCount: number;
}

export interface PnlCalendarWidgetData {
  months: Array<{
    year: number;
    month: number;
    grid: CalendarCellDTO[][];
    summary: MonthSummary;
  }>;
}

// ── Lists / tables ───────────────────────────────────────────────────────────

export interface OpenTradesWidgetData {
  openPositions: OpenPositionDTO[];
}

export interface RecentTradesWidgetData {
  trades: TradeListItemDTO[];
}

/** GroupStat with the optional strategy color (strategy-table only). */
export interface ColoredGroupStat extends GroupStat {
  color?: string;
}

export interface GroupsWidgetData {
  groups: ColoredGroupStat[];
}

// ── Charts ───────────────────────────────────────────────────────────────────

export interface RHistogramWidgetData {
  buckets: { buckets: RDistBucket[]; withoutR: number };
}

export interface WinLossWidgetData {
  wins: number;
  losses: number;
  breakevens: number;
}

export interface StreakWidgetData {
  current: number;
  maxWin: number;
  maxLoss: number;
}

// ── Process widgets ──────────────────────────────────────────────────────────

export interface JournalPromptWidgetData {
  prompt: string;
  hasEntryToday: boolean;
}

export interface ReviewQueueWidgetData {
  toReviewCount: number;
  draftCount: number;
}

export interface NewsEventDTO {
  id: string;
  title: string;
  currency: string;
  impact: string;
  category: string;
  scheduledAt: string;
}

export interface NextNewsWidgetData {
  events: NewsEventDTO[];
}

// ── Custom metric ────────────────────────────────────────────────────────────

export interface CustomMetricWidgetData {
  name: string;
  format: string;
  value: string | null;
  sampleSize: number;
  lowSample: boolean;
}

// ── Runtime type guards (tolerant — malformed payloads render empty) ─────────

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asKpiData(v: unknown): KpiWidgetData | null {
  return isObject(v) && "stats" in v && "extras" in v
    ? (v as unknown as KpiWidgetData)
    : null;
}

export function asCurveData(v: unknown): CurveWidgetData | null {
  return isObject(v) && "curve" in v && Array.isArray(v.curve)
    ? (v as unknown as CurveWidgetData)
    : null;
}

export function asCalendarData(v: unknown): PnlCalendarWidgetData | null {
  return isObject(v) && "months" in v && Array.isArray(v.months)
    ? (v as unknown as PnlCalendarWidgetData)
    : null;
}

export function asOpenTradesData(v: unknown): OpenTradesWidgetData | null {
  return isObject(v) && "openPositions" in v && Array.isArray(v.openPositions)
    ? (v as unknown as OpenTradesWidgetData)
    : null;
}

export function asTradesData(v: unknown): RecentTradesWidgetData | null {
  return isObject(v) && "trades" in v && Array.isArray(v.trades)
    ? (v as unknown as RecentTradesWidgetData)
    : null;
}

export function asGroupsData(v: unknown): GroupsWidgetData | null {
  return isObject(v) && "groups" in v && Array.isArray(v.groups)
    ? (v as unknown as GroupsWidgetData)
    : null;
}

export function asRHistogramData(v: unknown): RHistogramWidgetData | null {
  return isObject(v) && "buckets" in v && isObject(v.buckets)
    ? (v as unknown as RHistogramWidgetData)
    : null;
}

export function asWinLossData(v: unknown): WinLossWidgetData | null {
  return isObject(v) && "wins" in v ? (v as unknown as WinLossWidgetData) : null;
}

export function asStreakData(v: unknown): StreakWidgetData | null {
  return isObject(v) && "current" in v ? (v as unknown as StreakWidgetData) : null;
}

export function asJournalPromptData(v: unknown): JournalPromptWidgetData | null {
  return isObject(v) && "prompt" in v
    ? (v as unknown as JournalPromptWidgetData)
    : null;
}

export function asReviewQueueData(v: unknown): ReviewQueueWidgetData | null {
  return isObject(v) && "toReviewCount" in v
    ? (v as unknown as ReviewQueueWidgetData)
    : null;
}

export function asNewsData(v: unknown): NextNewsWidgetData | null {
  return isObject(v) && "events" in v && Array.isArray(v.events)
    ? (v as unknown as NextNewsWidgetData)
    : null;
}

export function asCustomMetricData(v: unknown): CustomMetricWidgetData | null {
  return isObject(v) && "name" in v && "format" in v
    ? (v as unknown as CustomMetricWidgetData)
    : null;
}
