/**
 * Trades "By day" view — pure helpers (no React, no DOM).
 *
 * The By day mode groups the SAME page of filtered trades as the table
 * (same query, same rows, same filters, same pagination) by entry day in
 * the user's timezone, newest day first. Day totals are sums over the
 * trades SHOWN in the group: a day split across two pages shows the
 * trades of the current page only, never a total that pretends to cover
 * trades that are not listed. Unit-tested in tests/unit/trades-by-day.test.ts.
 */
import { toD } from "@/lib/trading/dec";
import { localDateInTz } from "@/lib/analytics/calendar";
import type { TradeListItemDTO } from "@/lib/trading/dto";

export interface DayGroup {
  /** Entry day YYYY-MM-DD in the user's timezone. */
  date: string;
  /** Trades of the day, in the order the list query returned them. */
  trades: TradeListItemDTO[];
  /** Decimal sum of netPnl over the group's trades ("0" when none). */
  netPnl: string;
  /** Most frequent pnl currency in the group ("USD" when empty). */
  currency: string;
  /** Wins/losses by net P&L sign, same convention as the calendar grid:
   *  a positive P&L is a win, a negative one a loss. */
  wins: number;
  losses: number;
}

/**
 * Group trades by entry day. Groups come back newest day first; trades
 * inside a group keep the order they arrived in. An invalid timezone
 * falls back to the UTC calendar day rather than dropping the trade.
 */
export function groupTradesByDay(
  trades: TradeListItemDTO[],
  timezone: string
): DayGroup[] {
  const byDate = new Map<string, TradeListItemDTO[]>();
  for (const trade of trades) {
    const key =
      localDateInTz(new Date(trade.entryTime), timezone) ??
      new Date(trade.entryTime).toISOString().slice(0, 10);
    const list = byDate.get(key);
    if (list) list.push(trade);
    else byDate.set(key, [trade]);
  }
  const groups: DayGroup[] = [];
  for (const [date, list] of byDate) {
    let sum = toD(0);
    let wins = 0;
    let losses = 0;
    const currencies = new Map<string, number>();
    for (const trade of list) {
      const p = toD(trade.netPnl ?? 0);
      sum = sum.plus(p);
      if (p.gt(0)) wins += 1;
      else if (p.lt(0)) losses += 1;
      if (trade.pnlCurrency) {
        currencies.set(
          trade.pnlCurrency,
          (currencies.get(trade.pnlCurrency) ?? 0) + 1
        );
      }
    }
    let currency = "USD";
    let best = 0;
    for (const [code, n] of currencies) {
      if (n > best) {
        best = n;
        currency = code;
      }
    }
    groups.push({ date, trades: list, netPnl: sum.toString(), currency, wins, losses });
  }
  groups.sort((a, b) => b.date.localeCompare(a.date));
  return groups;
}
