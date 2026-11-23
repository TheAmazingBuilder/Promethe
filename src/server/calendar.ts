/**
 * Calendar aggregation (v1 phase 5) — per-trading-day P&L for the month grid.
 *
 * Trading days are computed with getTradingDay (user setting, default
 * MIDNIGHT_LOCAL = the local calendar day in the user's timezone
 * (profile.timezone)): a trade belongs to the trading day it CLOSED on.
 * Aggregation happens in SQL by grouping on a computed local date via raw
 * SQL date conversion? — no: SQLite has no TZ support. Instead we fetch the
 * month (+ a 1-day margin for TZ offsets and rollovers) and bucket in JS
 * through Intl, same approach as the analytics localDate breakdowns. Month
 * volumes are small (≤ a few hundred trades).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import {
  buildMonthGrid,
  computeDayStreaks,
  computeMonthSummary,
  monthBounds,
  summarizeDayTrades,
  type CalendarDay,
} from "@/lib/analytics/calendar";
import type { CalendarDayPayload, CalendarPayload } from "@/lib/trading/dto";
import type { CalendarDayQuery, CalendarQuery } from "@/lib/validations/journal";
import { journalDays } from "@/server/journal";
import { toTradeListItem } from "@/server/trades";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay } from "@/lib/time/trading-day";

const TRADE_SELECT = {
  exitTime: true,
  netPnl: true,
  rMultiple: true,
  resultType: true,
} as const;

type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

/** Working day with mutable decimal accumulators (stringified at the end). */
interface MutableDay extends CalendarDay {
  _pnl: ReturnType<typeof toD>;
  _rSum: ReturnType<typeof toD>;
  _rCount: number;
}

/**
 * Trading-day buckets over the month + margin. The margin (±1 day) covers
 * TZ offsets and rollovers: a UTC exit slightly outside the local month can
 * land inside it, and vice versa (a NY-close trade at 18:00 New York belongs
 * to the NEXT trading day).
 */
function bucketByTradingDay(
  rows: TradeRow[],
  dayOf: (d: Date) => string
): Map<string, MutableDay> {
  const map = new Map<string, MutableDay>();
  for (const t of rows) {
    if (t.exitTime == null) continue; // open trades are not P&L yet
    const local = dayOf(t.exitTime);
    const pnl = toD(t.netPnl ?? 0);
    const existing: MutableDay = map.get(local) ?? {
      date: local,
      netPnl: "0",
      tradeCount: 0,
      wins: 0,
      losses: 0,
      totalR: null,
      hasJournal: false,
      _pnl: toD(0),
      _rSum: toD(0),
      _rCount: 0,
    };
    existing._pnl = existing._pnl.plus(pnl);
    existing.tradeCount += 1;
    if (pnl.gt(0)) existing.wins += 1;
    else if (pnl.lt(0)) existing.losses += 1;
    if (t.rMultiple != null) {
      existing._rSum = existing._rSum.plus(toD(t.rMultiple));
      existing._rCount += 1;
    }
    map.set(local, existing);
  }
  return map;
}

export async function getCalendar(
  userId: string,
  query: CalendarQuery
): Promise<CalendarPayload> {
  const [profile, accounts, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getDisplayPreferences(userId),
  ]);

  // Account filter must belong to the user (silent fallback to "all").
  const accountFilter =
    query.account != null
      ? (accounts.find((a) => a.id === query.account) ?? null)
      : null;

  const timezone = profile?.timezone ?? "UTC";
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";
  // Trades are attributed to their TRADING day (user setting, default
  // MIDNIGHT_LOCAL = the local calendar day, i.e. the previous behaviour).
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);

  const { year, month } = query;
  const { first, last } = monthBounds(year, month);
  // Margin instants: one full day on each side covers every TZ offset.
  const from = new Date(`${first}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${last}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    exitTime: { gte: from, lt: to },
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  const [rows, journalSet] = await Promise.all([
    db.trade.findMany({ where, select: TRADE_SELECT }),
    journalDays(userId, first, last),
  ]);

  const buckets = bucketByTradingDay(rows, dayOf);
  // Mark journal days (only those inside the requested month matter).
  for (const d of journalSet) {
    const bucket = buckets.get(d);
    if (bucket) bucket.hasJournal = true;
    else buckets.set(d, {
      date: d,
      netPnl: "0",
      tradeCount: 0,
      wins: 0,
      losses: 0,
      totalR: null,
      hasJournal: true,
      _pnl: toD(0),
      _rSum: toD(0),
      _rCount: 0,
    });
  }

  // Final pass — stringify the decimal accumulators (DTO boundary).
  const days: CalendarDay[] = [...buckets.values()].map((d) => ({
    date: d.date,
    netPnl: d._pnl.toString(),
    tradeCount: d.tradeCount,
    wins: d.wins,
    losses: d.losses,
    totalR: d._rCount > 0 ? d._rSum.toString() : null,
    hasJournal: d.hasJournal,
  }));
  const summary = computeMonthSummary(days);
  const streaks = computeDayStreaks(days);

  // Grid — without the week numbers (pure presentation detail, DTO keeps it lean).
  const grid = buildMonthGrid(year, month).map((week) =>
    week.map(({ date, inMonth }) => ({ date, inMonth }))
  );

  const daysRecord: CalendarPayload["days"] = {};
  for (const d of days) daysRecord[d.date] = d;

  return {
    year,
    month,
    accountId: accountFilter?.id ?? null,
    currency,
    timezone,
    grid,
    days: daysRecord,
    summary,
    streaks,
  };
}

// ── One trading day (calendar day-detail panel, MRT wave 2) ─────────────────

/**
 * Closed trades of one TRADING day, with day totals — the same bucketing
 * as getCalendar (exit time through getTradingDay), so the panel totals
 * match the month grid cell exactly. The journal entry is NOT included:
 * the panel reads it with the existing useJournalEntry hook.
 */
export async function getCalendarDay(
  userId: string,
  query: CalendarDayQuery
): Promise<CalendarDayPayload> {
  const [profile, accounts, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getDisplayPreferences(userId),
  ]);

  // Account filter must belong to the user (silent fallback to "all").
  const accountFilter =
    query.account != null
      ? (accounts.find((a) => a.id === query.account) ?? null)
      : null;

  const timezone = profile?.timezone ?? "UTC";
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";
  // Trades are attributed to their TRADING day (user setting, default
  // MIDNIGHT_LOCAL = the local calendar day, i.e. the previous behaviour).
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);

  const { date } = query;
  // Margin instants: one full day on each side covers every TZ offset and
  // rollover, same as the month view.
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${date}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const rows = await db.trade.findMany({
    where: {
      userId,
      status: "CLOSED",
      isDraft: false,
      exitTime: { gte: from, lt: to },
      ...(accountFilter ? { accountId: accountFilter.id } : {}),
    },
    include: {
      instrument: true,
      account: true,
      strategy: true,
      tags: { include: { tag: true } },
      screenshots: {
        select: { id: true, tradeId: true, label: true, caption: true, createdAt: true },
      },
      review: { select: { mistakeTagIds: true } },
    },
    orderBy: { exitTime: "desc" },
  });
  const dayRows = rows.filter(
    (t) => t.exitTime != null && dayOf(t.exitTime) === date
  );
  const trades = dayRows.map((t) => toTradeListItem(t));
  const summary = summarizeDayTrades(trades);

  // Aggregate existing Trade Review mistake tags; never ask the trader to tag
  // the same behavior again at the daily Journal level.
  const mistakeCounts = new Map<string, number>();
  for (const trade of dayRows) {
    const raw = trade.review?.mistakeTagIds;
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of new Set(parsed.filter((value): value is string => typeof value === "string"))) {
          mistakeCounts.set(id, (mistakeCounts.get(id) ?? 0) + 1);
        }
      }
    } catch {
      // A malformed legacy review tag payload must not break the calendar.
    }
  }
  const mistakeTags = mistakeCounts.size > 0
    ? await db.tag.findMany({
        where: {
          id: { in: [...mistakeCounts.keys()] },
          kind: "MISTAKE",
          deletedAt: null,
          OR: [{ userId }, { userId: null }],
        },
        select: { id: true, name: true, color: true },
      })
    : [];
  const behavioralMistakes = mistakeTags
    .map((tag) => ({ ...tag, count: mistakeCounts.get(tag.id) ?? 0 }))
    .filter((tag) => tag.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    date,
    accountId: accountFilter?.id ?? null,
    currency,
    timezone,
    trades,
    screenshots: dayRows.flatMap((trade) =>
      trade.screenshots.map((screenshot) => ({
        id: screenshot.id,
        tradeId: screenshot.tradeId,
        symbol: trade.instrument.symbol,
        label: screenshot.label,
        caption: screenshot.caption,
        createdAt: screenshot.createdAt.toISOString(),
      }))
    ),
    behavioralMistakes,
    ...summary,
  };
}

// ── v2.5 Module 2 Phase 5 — yearly contribution calendar ─────────────────────

export interface YearDayPayload {
  date: string;
  netPnl: number;
  totalR: number | null;
  tradeCount: number;
  wins: number;
  losses: number;
  hasJournal: boolean;
  /** Discipline score from the journal entry (1-10). */
  discipline: number | null;
}

export interface YearDaysPayload {
  year: number;
  accountId: string | null;
  currency: string;
  timezone: string;
  days: Record<string, YearDayPayload>;
}

/**
 * Daily aggregates for the whole year (TRADING days — trades attributed to
 * their trading CLOSE day, same convention as the month view), plus journal
 * flags and discipline scores.
 */
export async function getYearDays(
  userId: string,
  year: number,
  accountId?: string
): Promise<YearDaysPayload> {
  const [profile, accounts, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getDisplayPreferences(userId),
  ]);
  const accountFilter =
    accountId != null ? (accounts.find((a) => a.id === accountId) ?? null) : null;
  const timezone = profile?.timezone ?? "UTC";
  const currency = accountFilter?.currency ?? profile?.baseCurrency ?? "USD";
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);

  const from = new Date(Date.UTC(year, 0, 1));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(year + 1, 0, 1));
  to.setUTCDate(to.getUTCDate() + 1);

  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    exitTime: { gte: from, lt: to },
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  const [rows, journalRows] = await Promise.all([
    db.trade.findMany({ where, select: TRADE_SELECT }),
    db.journalEntry.findMany({
      where: {
        userId,
        date: {
          gte: `${year}-01-01`,
          lte: `${year}-12-31`,
        },
      },
      select: { date: true, disciplineScore: true },
    }),
  ]);

  const days: Record<string, YearDayPayload> = {};
  const ensure = (date: string): YearDayPayload => {
    let d = days[date];
    if (!d) {
      d = {
        date,
        netPnl: 0,
        totalR: null,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        hasJournal: false,
        discipline: null,
      };
      days[date] = d;
    }
    return d;
  };

  for (const t of rows) {
    if (t.exitTime == null) continue;
    const d = ensure(dayOf(t.exitTime));
    const pnl = toD(t.netPnl ?? 0);
    d.netPnl += Number(pnl.toString());
    d.tradeCount += 1;
    if (pnl.gt(0)) d.wins += 1;
    else if (pnl.lt(0)) d.losses += 1;
    if (t.rMultiple != null) {
      d.totalR = (d.totalR ?? 0) + Number(t.rMultiple.toString());
    }
  }
  for (const j of journalRows) {
    const d = ensure(j.date);
    d.hasJournal = true;
    d.discipline =
      j.disciplineScore != null ? Number(j.disciplineScore.toString()) : null;
  }

  return {
    year,
    accountId: accountFilter?.id ?? null,
    currency,
    timezone,
    days,
  };
}
