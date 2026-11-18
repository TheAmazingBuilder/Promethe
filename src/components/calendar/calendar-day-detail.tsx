"use client";

/**
 * Calendar day-detail panel (MRT wave 2) — the detail MRT opens below its
 * calendar when a day is selected: the day's closed trades, day P&L, total
 * R, risk and setup per trade, plus the day's journal bias and lesson.
 *
 * Honest limits, by design:
 * - No grade column: Promethe stores no letter grade on a trade
 *   (decisionGrade does not exist), so no grade is shown rather than an
 *   invented one. A reviewed trade shows its review check via the result
 *   badge area, like the grid view.
 * - Bias and notes come from the JOURNAL entry of the day (marketBias,
 *   keyLesson), not from the trades: Promethe stores no per-trade bias.
 * - A day without closed trades shows an honest empty state, not a panel
 *   of zeros. Day totals come from the day endpoint, which buckets trades
 *   exactly like the month grid, so the panel matches the grid cell.
 * - Presentational only: data arrives via props, so the panel is
 *   unit-testable without network or database.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { BookOpen, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  DirectionBadge,
  ResultBadge,
  TagsBadges,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { confluenceTagsOf } from "@/lib/trading/confluences";
import { useI18n } from "@/i18n/i18n-provider";
import { useCalendarDay, useJournalEntry } from "@/hooks/use-journal";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";
import { navigate } from "@/lib/router";
import type {
  CalendarDayPayload,
  JournalEntryDTO,
} from "@/lib/trading/dto";

export interface CalendarDayDetailProps {
  /** Trading day YYYY-MM-DD. */
  date: string;
  /** Day payload from GET /api/v1/calendar/day (null while unloaded). */
  day: CalendarDayPayload | null;
  /** Journal entry of the day (null = none written yet). */
  journal: JournalEntryDTO | null;
  isLoading: boolean;
  journalLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onClose: () => void;
  timezone: string;
}

export function CalendarDayDetail({
  date,
  day,
  journal,
  isLoading,
  journalLoading,
  isError,
  onRetry,
  onClose,
  timezone,
}: CalendarDayDetailProps) {
  const t = useTranslations("calendarDay");
  const { locale } = useI18n();
  const labels = useTradingLabels();

  const heading = React.useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  }, [date, locale, timezone]);

  const currency = day?.currency ?? "USD";
  const trades = day?.trades ?? [];

  return (
    <Card aria-label={t("panelLabel", { date: heading })}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base capitalize">{heading}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isLoading
                ? t("loading")
                : day
                  ? t("tradesCount", { count: day.tradeCount })
                  : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">{t("loadError")}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("retry")}
            </Button>
          </div>
        ) : day == null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("loadError")}
          </p>
        ) : (
          <>
            {/* ── Day totals (real trades only; no zeros invented) ── */}
            {day.tradeCount > 0 ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t("netPnl")}</p>
                  <Money
                    signed
                    value={day.netPnl}
                    currency={currency}
                    className={`font-semibold tabular-nums ${pnlClass(day.netPnl)}`}
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("totalR")}</p>
                  <p className={`font-semibold tabular-nums ${pnlClass(day.totalR)}`}>
                    {day.totalR != null ? `${fmtSigned(day.totalR, 2, 2)} R` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("wins")}</p>
                  <p className="font-semibold tabular-nums text-gain">{day.wins}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("losses")}</p>
                  <p className="font-semibold tabular-nums text-loss">{day.losses}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-4 text-center">
                <p className="font-medium">{t("noTradesTitle")}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {t("noTradesDesc")}
                </p>
              </div>
            )}

            {/* ── Trades of the day ── */}
            {trades.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border">
                {trades.map((trade) => (
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
                        <span>
                          {t("setup")}:{" "}
                          {trade.strategyName ?? trade.setupType ?? "-"}
                        </span>
                        {trade.session ? (
                          <span>{labels.session(trade.session)}</span>
                        ) : null}
                        <span>
                          {t("risk")}:{" "}
                          {trade.riskPercent != null
                            ? `${fmtNum(trade.riskPercent, 2)}%`
                            : "-"}
                        </span>
                        <span>
                          {t("rMultiple")}:{" "}
                          {trade.rMultiple != null
                            ? `${fmtSigned(trade.rMultiple, 2, 2)} R`
                            : "-"}
                        </span>
                        <span>
                          {t("plannedRR")}:{" "}
                          {trade.plannedRR != null
                            ? `1 : ${fmtNum(trade.plannedRR, 2)}`
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
            )}

            {/* ── Journal of the day: bias and lesson ── */}
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t("journal")}
              </p>
              {journalLoading ? (
                <Skeleton className="mt-2 h-4 w-2/3" />
              ) : journal ? (
                <div className="mt-2 space-y-1.5 text-sm">
                  <p>
                    <span className="text-muted-foreground">{t("bias")}: </span>
                    {journal.marketBias ?? "-"}
                  </p>
                  {journal.keyLesson ? (
                    <p>
                      <span className="text-muted-foreground">
                        {t("keyLesson")}:{" "}
                      </span>
                      {journal.keyLesson}
                    </p>
                  ) : null}
                  {journal.disciplineScore != null ? (
                    <p>
                      <span className="text-muted-foreground">
                        {t("discipline")}:{" "}
                      </span>
                      <span className="tabular-nums">
                        {journal.disciplineScore}/10
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("noJournal")}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => navigate(`/journal/${date}`)}
              >
                {journal ? t("openJournal") : t("writeJournal")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Data-connected wrapper ───────────────────────────────────────────────────

/**
 * Wires the day payload and the journal entry into the presentational
 * panel. Rendered only when a day is selected, so neither query runs
 * before the user clicks a day.
 */
export function CalendarDayDetailPanel({
  date,
  accountId,
  timezone,
  onClose,
}: {
  date: string;
  accountId: string | undefined;
  timezone: string;
  onClose: () => void;
}) {
  const dayQuery = useCalendarDay(date, accountId);
  const journalQuery = useJournalEntry(date);
  return (
    <CalendarDayDetail
      date={date}
      day={dayQuery.data ?? null}
      journal={journalQuery.data ?? null}
      isLoading={dayQuery.isLoading}
      journalLoading={journalQuery.isLoading}
      isError={dayQuery.isError}
      onRetry={() => {
        void dayQuery.refetch();
        void journalQuery.refetch();
      }}
      onClose={onClose}
      timezone={timezone}
    />
  );
}
