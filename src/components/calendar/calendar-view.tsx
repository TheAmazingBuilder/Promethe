"use client";

/**
 * Calendar view (v1 phase 5) — month grid of daily net P&L with journal
 * markers, month summary and day streaks. Clicking a day deep-links to its
 * journal entry (/journal/{date}). Data: GET /api/v1/calendar.
 */
import * as React from "react";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
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
import { QueryErrorState } from "@/components/ui/query-error-state";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { YearCalendar } from "@/components/charts/year-calendar";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarDayDetailPanel } from "@/components/calendar/calendar-day-detail";
import { useAccounts } from "@/hooks/use-trading";
import { useCalendar } from "@/hooks/use-journal";
import { useTimePrefs } from "@/components/time/time-provider";
import { pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { toD } from "@/lib/trading/dec";

const EMERALD_BG = "bg-gain-subtle";
const ROSE_BG = "bg-loss-subtle";

export function CalendarView() {
  const t = useTranslations("calendar");
  const fmt = useFormat();
  // "Today" is the current TRADING day (user setting, default MIDNIGHT_LOCAL
  // = the local calendar day). The server buckets the P&L by the same day.
  const { tradingDayOf, loaded: timeLoaded } = useTimePrefs();
  const today = React.useMemo(
    () => tradingDayOf(),
    [tradingDayOf, timeLoaded]
  );
  const [cursor, setCursor] = React.useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m };
  });
  // Once the server row arrives the trading day can shift to another month
  // (e.g. NY close after 17:00 on the last day of the month) — follow it.
  const initialMonthRef = React.useRef(`${cursor.year}-${cursor.month}`);
  React.useEffect(() => {
    if (!timeLoaded) return;
    const [y, m] = today.split("-").map(Number);
    const key = `${y}-${m}`;
    if (initialMonthRef.current !== key) {
      initialMonthRef.current = key;
      setCursor({ year: y, month: m });
    }
    // Runs once when the time preferences finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLoaded]);
  const [accountId, setAccountId] = React.useState<string>("all");
  // v2.5 M2 — year (contribution calendar) vs month mode.
  const [mode, setMode] = React.useState<"month" | "year">("month");
  // MRT wave 2 — selected day for the detail panel below the grid. Clicking
  // a day selects it (no longer deep-links to the journal: the panel links
  // there). The selection clears when the month or account changes, so the
  // panel never shows a day from another view.
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSelectedDay(null);
  }, [cursor.year, cursor.month, accountId]);

  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];
  const effectiveAccount = accountId === "all" ? undefined : accountId;
  const { data, isLoading, isError, refetch } = useCalendar(
    cursor.year,
    cursor.month,
    effectiveAccount,
  );

  const currency = data?.currency ?? "USD";
  const weekdays = t.raw("weekdays") as unknown as string[];
  const monthNames = t.raw("monthNames") as unknown as string[];

  const prevMonth = () =>
    setCursor((c) =>
      c.month === 1 ? { year: c.year - 1, month: 12 } : { ...c, month: c.month - 1 },
    );
  const nextMonth = () =>
    setCursor((c) =>
      c.month === 12 ? { year: c.year + 1, month: 1 } : { ...c, month: c.month + 1 },
    );
  const goToday = () => {
    const [y, m] = today.split("-").map(Number);
    setCursor({ year: y, month: m });
  };

  const summary = data?.summary;
  const streaks = data?.streaks;

  return (
    <section aria-labelledby="calendar-title" className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Header */}
      <PageHeader
        id="calendar-title"
        title={t("title")}
        description={t("subtitle")}
        className="flex-wrap sm:items-end"
        actions={
          <>
            {/* a11y (M8 Phase 5): wraps at 200 % text / narrow viewports (WCAG 1.4.10). */}
          {/* v2.5 M2 — month / year mode toggle. a11y (M8 Phase 5): a
              segmented ToggleGroup, NOT Tabs - a tabset without panels dangles
              aria-controls (aria-valid-attr-value). */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => {
              if (v) setMode(v as typeof mode);
            }}
          >
            <ToggleGroupItem value="month">{t("modeMonth")}</ToggleGroupItem>
            <ToggleGroupItem value="year">{t("modeYear")}</ToggleGroupItem>
          </ToggleGroup>
          {accounts.length > 1 ? (
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-[180px]" aria-label={t("accountAll")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("accountAll")}</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <Sensitive kind="account">{a.name}</Sensitive>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" onClick={goToday}>
            {t("today")}
          </Button>
          </>
        }
      />

      {mode === "month" && isError ? (
        <QueryErrorState
          title="Calendar data could not be loaded"
          description="Check your connection and try again. Your journal entries are safe."
          onRetry={() => void refetch()}
        />
      ) : (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Year contribution calendar (v2.5 M2) */}
        {mode === "year" ? (
          <div className="lg:col-span-2">
            <YearCalendar
              year={cursor.year}
              onYearChange={(year) => setCursor((c) => ({ ...c, year }))}
            />
          </div>
        ) : (
        <>
        {/* Month grid */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={prevMonth}
                aria-label={t("prevMonth")}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <CardTitle className="text-base tabular-nums">
                {monthNames[cursor.month - 1]} {cursor.year}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={nextMonth}
                aria-label={t("nextMonth")}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                {/* Weekday header + grid scroll together at extreme scales
                    (WCAG 1.4.10 exception for data-dense grids). */}
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("title")}>
                <div className="mb-1 grid min-w-[30rem] grid-cols-7 gap-1.5">
                  {weekdays.map((wd) => (
                    <div
                      key={wd}
                      className="py-1 text-center text-xs font-medium text-muted-foreground"
                    >
                      {wd}
                    </div>
                  ))}
                </div>
                <div className="grid min-w-[30rem] grid-cols-7 gap-1.5">
                  {(data?.grid ?? []).flat().map((cell) => {
                    const day = data?.days?.[cell.date];
                    const pnl = day && day.tradeCount > 0 ? toD(day.netPnl) : null;
                    const isToday = cell.date === today;
                    const isSelected = selectedDay === cell.date;
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() => setSelectedDay(cell.date)}
                        aria-pressed={isSelected}
                        aria-label={[
                          // a11y (M8 Phase 5): axe's label-content-name-mismatch
                          // requires the VISIBLE text tokens (day number, P&L,
                          // trade count — in DOM order) to appear as a
                          // contiguous subsequence of the name, so the date
                          // context goes LAST. fmt.signedMoney is privacy-aware
                          // so HIDE mode stays leak-free ("••••" both sides).
                          String(Number(cell.date.slice(8))),
                          day && day.tradeCount > 0
                            ? fmt.signedMoney(day.netPnl, currency)
                            : "",
                          day && day.tradeCount > 0
                            ? t("tradesCount", { count: day.tradeCount })
                            : "",
                          `${monthNames[Number(cell.date.slice(5, 7)) - 1]} ${cell.date.slice(0, 4)}`,
                        ]
                          .filter(Boolean)
                          .join(" - ")}
                        className={[
                          "relative flex min-h-[64px] flex-col justify-between rounded-lg border p-1.5 text-left transition-colors",
                          // a11y (M8 Phase 5): AA-safe dimming — a dashed border
                          // + muted background instead of opacity-40 text
                          // (blended color failed color-contrast).
                          cell.inMonth ? "" : "border-dashed bg-muted/30",
                          isToday && !isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
                          isSelected ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-background" : "",
                          pnl ? (pnl.gt(0) ? EMERALD_BG : pnl.lt(0) ? ROSE_BG : "") : "",
                          "hover:bg-muted/60",
                        ].join(" ")}
                      >
                        <span className="text-xs font-medium tabular-nums">
                          {Number(cell.date.slice(8))}
                        </span>
                        {day && day.tradeCount > 0 ? (
                          <span className="flex flex-col items-start gap-0.5">
                            <Money
                              signed
                              value={day.netPnl}
                              currency={currency}
                              className={`text-xs font-semibold ${pnlClass(day.netPnl)}`}
                            />
                            {/* a11y (M8 Phase 5): axe concatenates span text
                                without element boundaries - "USD" + "1 trade"
                                would mash into "USD1" and break the label
                                token match. A real space text node keeps the
                                tokens separate (visually nil in flex gap). */}
                            {" "}
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {t("tradesCount", { count: day.tradeCount })}
                            </span>
                          </span>
                        ) : null}
                        {day?.hasJournal ? (
                          <BookOpen
                            className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground"
                            aria-label={t("journalDone")}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                </div>
                {/* Legend */}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block h-2.5 w-2.5 rounded-sm ${EMERALD_BG}`} />
                    {t("legendGain")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ROSE_BG}`} />
                    {t("legendLoss")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="h-3 w-3" aria-hidden="true" />
                    {t("legendJournal")}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Summary + streaks */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("summary.netPnl")}</CardTitle>
              {summary ? (
                <Money
                  signed
                  value={summary.netPnl}
                  currency={currency}
                  className={`whitespace-normal text-2xl font-bold ${pnlClass(summary.netPnl)}`}
                />
              ) : (
                <Skeleton className="h-8 w-24" />
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("summary.tradingDays")}</p>
                <p className="font-semibold tabular-nums">
                  {summary?.tradingDays ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("summary.greenRate")}</p>
                <p className="font-semibold tabular-nums">
                  {summary?.greenRate != null
                    ? fmt.pct(summary.greenRate, 0)
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("summary.bestDay")}</p>
                <p className={`font-semibold tabular-nums ${summary?.bestDay ? pnlClass(summary.bestDay.netPnl) : ""}`}>
                  {summary?.bestDay ? (
                    <Money
                      signed
                      className="whitespace-normal"
                      value={summary.bestDay.netPnl}
                      currency={currency}
                    />
                  ) : (
                    "-"
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("summary.worstDay")}</p>
                <p className={`font-semibold tabular-nums ${summary?.worstDay ? pnlClass(summary.worstDay.netPnl) : ""}`}>
                  {summary?.worstDay ? (
                    <Money
                      signed
                      className="whitespace-normal"
                      value={summary.worstDay.netPnl}
                      currency={currency}
                    />
                  ) : (
                    "-"
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("streaks.title")}</CardTitle>
              <CardDescription className="tabular-nums">
                {streaks == null
                  ? "-"
                  : streaks.current > 0
                    ? t("streaks.currentWin", { count: streaks.current })
                    : streaks.current < 0
                      ? t("streaks.currentLoss", { count: -streaks.current })
                      : t("streaks.currentNone")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("streaks.longestWin")}</p>
                <p className="font-semibold text-gain tabular-nums">
                  {streaks ? t("streaks.days", { count: streaks.longestWin }) : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("streaks.longestLoss")}</p>
                <p className="font-semibold text-loss tabular-nums">
                  {streaks ? t("streaks.days", { count: streaks.longestLoss }) : "-"}
                </p>
              </div>
            </CardContent>
          </Card>

          {data != null &&
          data.summary.tradingDays === 0 &&
          Object.keys(data.days).length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              {t("emptyTitle")} - {t("emptyDesc")}
            </p>
          ) : null}
        </div>
        </>
        )}
      </div>
      )}

      {/* MRT wave 2 — day-detail panel, below the grid. */}
      {mode === "month" && selectedDay ? (
        <CalendarDayDetailPanel
          date={selectedDay}
          accountId={effectiveAccount}
          timezone={data?.timezone ?? "UTC"}
          onClose={() => setSelectedDay(null)}
        />
      ) : null}
    </section>
  );
}
