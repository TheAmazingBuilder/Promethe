"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/ui/query-error-state";
import { useRecentJournal } from "@/hooks/use-journal";
import { fmtDateInTz } from "@/lib/format";

export function JournalHistorySection({
  selectedDay,
  onSelectDay,
}: {
  selectedDay: string;
  onSelectDay: (date: string) => void;
}) {
  const t = useTranslations("journalView");
  const [historySearchInput, setHistorySearchInput] = React.useState("");
  const [historyQuery, setHistoryQuery] = React.useState("");
  const [historyFrom, setHistoryFrom] = React.useState("");
  const [historyTo, setHistoryTo] = React.useState("");
  const [historyMood, setHistoryMood] = React.useState("");
  const [historyDiscipline, setHistoryDiscipline] = React.useState("");
  const {
    data: recentPages,
    isLoading: recentLoading,
    hasNextPage: hasMoreHistory,
    isFetchingNextPage,
    isError: recentError,
    isFetchNextPageError,
    refetch: refetchRecent,
    fetchNextPage,
  } = useRecentJournal({
    q: historyQuery || undefined,
    from: historyFrom || undefined,
    to: historyTo || undefined,
    mood: historyMood ? Number(historyMood) : undefined,
    discipline: historyDiscipline ? Number(historyDiscipline) : undefined,
    limit: 20,
  });
  const recentEntries = React.useMemo(
    () => recentPages?.pages.flatMap((page) => page.entries) ?? [],
    [recentPages],
  );
  const invalidHistoryRange = Boolean(historyFrom && historyTo && historyFrom > historyTo);

  return (
          <Card id="journal-history" className="scroll-mt-24 border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-base">{t("recent.title")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Your latest trading-day notes.
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                {recentEntries.length} loaded
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto_auto_auto]">
                <Input
                  value={historySearchInput}
                  onChange={(event) => setHistorySearchInput(event.target.value)}
                  placeholder="Search plans, levels, lessons and market bias..."
                  className="h-10"
                  maxLength={120}
                  aria-label="Search Journal history"
                />
                <DateField
                  id="journal-history-from"
                  value={historyFrom}
                  onChange={setHistoryFrom}
                  ariaLabel="From date"
                  className="w-full"
                />
                <DateField
                  id="journal-history-to"
                  value={historyTo}
                  onChange={setHistoryTo}
                  ariaLabel="To date"
                  className="w-full"
                />
                <Select
                  value={historyMood || "any"}
                  onValueChange={(value) => setHistoryMood(value === "any" ? "" : value)}
                >
                  <SelectTrigger className="h-10 w-full min-w-0" aria-label="Filter by mood">
                    <SelectValue placeholder="Any mood" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any mood</SelectItem>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <SelectItem key={score} value={String(score)}>Mood {score}/5</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={historyDiscipline || "any"}
                  onValueChange={(value) => setHistoryDiscipline(value === "any" ? "" : value)}
                >
                  <SelectTrigger className="h-10 w-full min-w-0" aria-label="Filter by discipline">
                    <SelectValue placeholder="Any discipline" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any discipline</SelectItem>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <SelectItem key={score} value={String(score)}>Discipline {score}/5</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => setHistoryQuery(historySearchInput.trim())}
                  disabled={Boolean(historyFrom && historyTo && historyFrom > historyTo)}
                >
                  Search
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setHistorySearchInput("");
                    setHistoryQuery("");
                    setHistoryFrom("");
                    setHistoryTo("");
                    setHistoryMood("");
                    setHistoryDiscipline("");
                  }}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const params = new URLSearchParams({ from: historyFrom, to: historyTo });
                    window.location.assign(`/api/v1/journal/export?${params.toString()}`);
                  }}
                  disabled={!historyFrom || !historyTo || historyFrom > historyTo}
                >
                  Export PDF
                </Button>
              </div>
              {invalidHistoryRange ? (
                <p className="mb-3 text-xs text-destructive" role="alert">The start date must be on or before the end date.</p>
              ) : recentError && recentEntries.length === 0 ? (
                <QueryErrorState
                  title="Journal history could not be loaded"
                  description="Your saved entries are safe. Check your connection and try again."
                  onRetry={() => void refetchRecent()}
                />
              ) : recentLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : recentEntries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  {historyQuery || historyFrom || historyTo || historyMood || historyDiscipline
                    ? "No Journal entries match these filters."
                    : t("recent.empty")}
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {recentEntries.map((recent) => {
                    const isCurrent = recent.date === selectedDay;
                    const summary =
                      recent.keyLesson?.trim() ||
                      recent.primaryScenario?.trim() ||
                      recent.keyLevels?.trim() ||
                      recent.marketBias?.trim() ||
                      recent.preMarketPlan?.trim() ||
                      recent.postMarketReview?.trim() ||
                      t("untitled");
                    return (
                      <button
                        key={recent.id}
                        type="button"
                        onClick={() => onSelectDay(recent.date)}
                        aria-current={isCurrent ? "date" : undefined}
                        className={[
                          "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-3 text-left transition-colors",
                          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isCurrent ? "bg-muted/50" : "",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {fmtDateInTz(`${recent.date}T12:00:00Z`, "UTC")}
                            </span>
                            {isCurrent ? <Badge variant="secondary" className="text-[9px]">Current</Badge> : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
              {!invalidHistoryRange && isFetchNextPageError ? (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2" role="alert">
                  <p className="text-xs text-destructive">More entries could not be loaded.</p>
                  <Button size="sm" variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>Try again</Button>
                </div>
              ) : !invalidHistoryRange && hasMoreHistory ? (
                <div className="mt-3 flex justify-center">
                  <Button size="sm" variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? "Loading…" : "Load more entries"}
                  </Button>
                </div>
              ) : !invalidHistoryRange && recentEntries.length > 0 ? (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">You&apos;ve reached the end of your Journal history.</p>
              ) : null}
            </CardContent>
          </Card>
  );
}
