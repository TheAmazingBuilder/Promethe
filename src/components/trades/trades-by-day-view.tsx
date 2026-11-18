"use client";

/**
 * Trades "By day" view (MRT wave 2) — third Trade Log mode next to Table
 * and Grid: the same page of filtered trades, grouped by entry day in
 * the user's timezone, newest day first. Each day header shows the trade
 * count, the win/loss split and the net P&L of the trades listed under
 * it (page-scoped sums, see @/lib/trades/by-day).
 *
 * Honest limits, by design:
 * - No grade badge: Promethe stores no letter grade on a trade
 *   (decisionGrade does not exist), so no grade is shown rather than an
 *   invented one.
 * - Day totals cover the trades listed under the header only. A day
 *   split across two pages never shows a total that pretends to cover
 *   trades on another page.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  DirectionBadge,
  ResultBadge,
  TagsBadges,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { confluenceTagsOf } from "@/lib/trading/confluences";
import { useI18n } from "@/i18n/i18n-provider";
import { fmtDateTimeInTz, fmtSigned, pnlClass } from "@/lib/format";
import { navigate } from "@/lib/router";
import { groupTradesByDay } from "@/lib/trades/by-day";
import type { TradeListItemDTO } from "@/lib/trading/dto";

export function TradesByDayView({
  trades,
  timezone,
}: {
  trades: TradeListItemDTO[];
  timezone: string;
}) {
  const t = useTranslations("tradesByDay");
  const { locale } = useI18n();
  const labels = useTradingLabels();
  const groups = React.useMemo(
    () => groupTradesByDay(trades, timezone),
    [trades, timezone]
  );

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const [y, m, d] = group.date.split("-").map(Number);
        const heading = new Intl.DateTimeFormat(locale, {
          timeZone: timezone,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(Date.UTC(y, m - 1, d, 12)));
        return (
          <section key={group.date} aria-label={heading}>
            {/* ── Day header: date, count, W/L, day P&L ── */}
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
              <h3 className="text-sm font-semibold capitalize">{heading}</h3>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t("tradesCount", { count: group.trades.length })}
                </span>
                <span className="tabular-nums">
                  {t("winLoss", { wins: group.wins, losses: group.losses })}
                </span>
                <Money
                  signed
                  value={group.netPnl}
                  currency={group.currency}
                  className={`text-sm font-semibold tabular-nums ${pnlClass(group.netPnl)}`}
                />
              </p>
            </div>

            {/* ── Trades of the day ── */}
            <ul className="divide-y divide-border rounded-lg border">
              {group.trades.map((trade) => (
                <li key={trade.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/trades/${trade.id}`)}
                    aria-label={t("openTrade", { symbol: trade.symbol })}
                    className="flex w-full flex-col gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          {trade.symbol}
                        </span>
                        <DirectionBadge direction={trade.direction} />
                        {trade.resultType ? (
                          <ResultBadge result={trade.resultType} />
                        ) : null}
                      </span>
                      <Money
                        signed
                        value={trade.netPnl}
                        currency={trade.pnlCurrency}
                        className={`text-sm font-semibold tabular-nums ${pnlClass(trade.netPnl)}`}
                      />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{fmtDateTimeInTz(trade.entryTime, timezone)}</span>
                      {trade.session ? (
                        <span>{labels.session(trade.session)}</span>
                      ) : null}
                      <span>
                        {trade.strategyName ?? trade.setupType ?? "-"}
                      </span>
                      <span>
                        {trade.rMultiple != null
                          ? `${fmtSigned(trade.rMultiple, 2, 2)} R`
                          : "-"}
                      </span>
                      <span>
                        <Sensitive kind="account">{trade.accountName}</Sensitive>
                      </span>
                    </span>
                    <TagsBadges tags={confluenceTagsOf(trade.tags)} max={3} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
