"use client";

/**
 * When you trade (MRT wave 2) — section inside the Analytics page.
 *
 * P&L and trade count by local entry hour, by weekday, and the
 * session x weekday matrix. Only sessions present in the data get a
 * row; the best hour and best day are only named once their slot holds
 * at least MIN_SAMPLE_WHEN_YOU_TRADE trades. Every bar, row and cell
 * is a link to the trade list filtered on that slot
 * (/trades?entryHour=… / entryWeekday=… / session=…&entryWeekday=…).
 */
import * as React from "react";
import { AlertTriangle, Clock, CalendarDays, RotateCw, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/privacy/money";
import { useTradingLabels } from "@/components/trades/trade-bits";
import { useI18n } from "@/i18n/i18n-provider";
import { useWhenYouTrade } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import type {
  HourCell,
  MatrixCell,
  WeekdayCell,
} from "@/lib/analytics/when-you-trade";
import { fmtNum, pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

export function WhenYouTradeSection({
  period,
  accountId,
  currency,
}: {
  period: AnalyticsPeriod;
  accountId: string;
  currency: string;
}) {
  const t = useTranslations("analytics.whenYouTrade");
  const labels = useTradingLabels();
  const { locale } = useI18n();
  const fmt = useFormat();
  const effectiveAccount = accountId === "all" ? undefined : accountId;
  const { data, isLoading, isError, refetch } = useWhenYouTrade({
    period,
    account: effectiveAccount,
  });

  const weekdayLong = React.useCallback(
    (weekday: number) => {
      try {
        // ISO weekday 1-7, localized via a stable reference week
        // (2024-01-01 was a Monday).
        const ref = new Date(Date.UTC(2024, 0, weekday));
        return new Intl.DateTimeFormat(locale, {
          weekday: "long",
          timeZone: "UTC",
        }).format(ref);
      } catch {
        return String(weekday);
      }
    },
    [locale]
  );

  const weekdayShort = React.useCallback(
    (weekday: number) => {
      try {
        const ref = new Date(Date.UTC(2024, 0, weekday));
        return new Intl.DateTimeFormat(locale, {
          weekday: "short",
          timeZone: "UTC",
        }).format(ref);
      } catch {
        return String(weekday);
      }
    },
    [locale]
  );

  const hourLabel = (hour: number) => `${two(hour)}:00`;

  const openHour = (hour: number) => navigate(`/trades?entryHour=${hour}`);
  const openWeekday = (weekday: number) =>
    navigate(`/trades?entryWeekday=${weekday}`);
  const openCell = (session: string, weekday: number) =>
    navigate(
      `/trades?session=${encodeURIComponent(session)}&entryWeekday=${weekday}`
    );

  const maxAbsHour = React.useMemo(
    () =>
      (data?.byHour ?? []).reduce(
        (m, h) => Math.max(m, Math.abs(Number(h.netPnl))),
        0
      ),
    [data]
  );

  const cellFor = React.useCallback(
    (session: string, weekday: number): MatrixCell | undefined =>
      data?.matrix.find(
        (c) => c.session === session && c.weekday === weekday
      ),
    [data]
  );

  const highlightSub = (cell: { count: number; winRate: number | null; netPnl: string }) =>
    t("highlightSub", {
      count: cell.count,
      winRate: cell.winRate != null ? fmt.pct(cell.winRate) : "-",
      pnl: fmt.signedMoney(cell.netPnl, currency),
    });

  return (
    <section aria-label={t("title")} id="when-you-trade">
      <h3 className="mb-3 text-base font-semibold">{t("title")}</h3>
      {isLoading ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <span className="sr-only">{t("loading")}</span>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium">{t("errorTitle")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t("errorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : !data || data.total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("emptyTitle")}</CardTitle>
            <CardDescription>{t("emptyDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/trades/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("emptyAction")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Best hour / best day */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border p-4">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("bestHour")}
              </p>
              {data.bestHour ? (
                <>
                  <button
                    type="button"
                    onClick={() => openHour(data.bestHour!.hour)}
                    className="w-fit cursor-pointer text-left text-2xl font-bold tabular-nums underline-offset-4 hover:underline"
                  >
                    {hourLabel(data.bestHour.hour)}
                  </button>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {highlightSub(data.bestHour)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("bestNone", { min: data.minSample })}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 rounded-lg border p-4">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {t("bestDay")}
              </p>
              {data.bestWeekday ? (
                <>
                  <button
                    type="button"
                    onClick={() => openWeekday(data.bestWeekday!.weekday)}
                    className="w-fit cursor-pointer text-left text-2xl font-bold underline-offset-4 hover:underline"
                  >
                    {weekdayLong(data.bestWeekday.weekday)}
                  </button>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {highlightSub(data.bestWeekday)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("bestNone", { min: data.minSample })}
                </p>
              )}
            </div>
          </div>

          {/* By hour */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("byHourTitle")}</CardTitle>
              <CardDescription>{t("byHourDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="flex h-36 items-end gap-0.5"
                role="list"
                aria-label={t("byHourTitle")}
              >
                {data.byHour.map((h: HourCell) => {
                  const net = Number(h.netPnl);
                  const height =
                    maxAbsHour > 0
                      ? Math.max(h.count > 0 ? 4 : 0, (Math.abs(net) / maxAbsHour) * 100)
                      : 0;
                  return (
                    <button
                      key={h.hour}
                      type="button"
                      role="listitem"
                      onClick={() => openHour(h.hour)}
                      title={t("hourTip", {
                        hour: hourLabel(h.hour),
                        count: h.count,
                        pnl: fmt.signedMoney(h.netPnl, currency),
                      })}
                      aria-label={t("hourTip", {
                        hour: hourLabel(h.hour),
                        count: h.count,
                        pnl: fmt.signedMoney(h.netPnl, currency),
                      })}
                      className="group flex h-full flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span
                        className={cn(
                          "w-full rounded-sm transition-transform duration-200 motion-reduce:transition-none",
                          net >= 0 ? "bg-gain" : "bg-loss",
                          h.count === 0 && "opacity-0"
                        )}
                        style={{ height: `${height}%` }}
                        aria-hidden="true"
                      />
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {h.hour % 3 === 0 ? two(h.hour) : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("hourNote", { total: data.total })}
              </p>
            </CardContent>
          </Card>

          {/* By weekday */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("byWeekdayTitle")}</CardTitle>
              <CardDescription>{t("byWeekdayDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {data.byWeekday.map((d: WeekdayCell) => {
                  const net = Number(d.netPnl);
                  const maxAbs = data.byWeekday.reduce(
                    (m, x) => Math.max(m, Math.abs(Number(x.netPnl))),
                    0
                  );
                  const width =
                    maxAbs > 0
                      ? Math.max(d.count > 0 ? 2 : 0, (Math.abs(net) / maxAbs) * 100)
                      : 0;
                  return (
                    <li key={d.weekday}>
                      <button
                        type="button"
                        onClick={() => openWeekday(d.weekday)}
                        className="relative flex w-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label={t("weekdayTip", {
                          day: weekdayLong(d.weekday),
                          count: d.count,
                          pnl: fmt.signedMoney(d.netPnl, currency),
                        })}
                      >
                        <span
                          className={cn(
                            "absolute inset-y-0 left-0",
                            net >= 0 ? "bg-gain-subtle" : "bg-loss-subtle"
                          )}
                          style={{ width: `${width}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative z-10 min-w-0 truncate font-medium">
                          {weekdayLong(d.weekday)}
                        </span>
                        <span className="relative z-10 flex shrink-0 items-center gap-3 tabular-nums">
                          <span className="text-xs text-muted-foreground">
                            x{d.count}
                          </span>
                          <span className="hidden w-16 whitespace-nowrap text-right text-xs text-muted-foreground sm:inline">
                            {d.winRate != null ? fmt.pct(d.winRate) : "-"}
                          </span>
                          <Money
                            signed
                            value={d.netPnl}
                            currency={currency}
                            className={cn("w-24 text-right font-medium", pnlClass(d.netPnl))}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("sampleNote", { min: data.minSample })}
              </p>
            </CardContent>
          </Card>

          {/* Session x weekday matrix */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("matrixTitle")}</CardTitle>
              <CardDescription>{t("matrixDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("matrixEmpty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                          {t("matrixSession")}
                        </th>
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <th
                            key={d}
                            className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground"
                          >
                            {weekdayShort(d)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.sessions.map((session) => (
                        <tr key={session} className="border-t">
                          <th className="px-2 py-1.5 text-left font-medium">
                            {labels.session(session)}
                          </th>
                          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                            const cell = cellFor(session, d);
                            if (!cell) {
                              return (
                                <td
                                  key={d}
                                  className="px-2 py-1.5 text-right text-muted-foreground/40"
                                  aria-label={t("matrixCellEmpty", {
                                    session: labels.session(session),
                                    day: weekdayLong(d),
                                  })}
                                >
                                  -
                                </td>
                              );
                            }
                            const net = Number(cell.netPnl);
                            return (
                              <td key={d} className="px-1 py-1 text-right">
                                <button
                                  type="button"
                                  onClick={() => openCell(session, d)}
                                  className="w-full cursor-pointer rounded-md px-2 py-1.5 tabular-nums transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                  aria-label={t("matrixCellTip", {
                                    session: labels.session(session),
                                    day: weekdayLong(d),
                                    count: cell.count,
                                    pnl: fmt.signedMoney(cell.netPnl, currency),
                                  })}
                                >
                                  <span
                                    className={cn(
                                      "block font-medium",
                                      net >= 0 ? "text-gain" : "text-loss"
                                    )}
                                  >
                                    <Money signed value={cell.netPnl} currency={currency} />
                                  </span>
                                  <span className="block text-[11px] text-muted-foreground">
                                    {t("cellTrades", { count: cell.count })}
                                  </span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {t("matrixNote")}
              </p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            {t("timezoneNote", { total: fmtNum(data.total, 0) })}
          </p>
        </div>
      )}
    </section>
  );
}
