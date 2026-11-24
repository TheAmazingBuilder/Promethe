"use client";

/**
 * v3 Phase 5 — One mentee's journal, /mentor/{ownerId}: persistent read-only
 * banner, tabs (trades / journal / analytics). Every payload comes scoped +
 * redacted from the server; journal/analytics show a permission notice when
 * the owner disabled them. Trades navigate to /mentor/{ownerId}/trades/{id}.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  ArrowLeft,
  EyeOff,
  Loader2,
  NotebookPen,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import type { MenteeSummaryDTO } from "@/lib/mentor/dto";

interface MentorTradesPage {
  data: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface MentorAnalytics {
  tradeCount: number;
  kpisAllTime: Record<string, unknown> | null;
  equityCurve: { time: string; value: number }[];
  equityUnit: "CURRENCY" | "PERCENT" | "R";
  openCount: number;
  toReviewCount: number;
}

interface MentorJournal {
  entries: {
    id: string;
    date: string;
    preMarketPlan: string | null;
    postMarketReview: string | null;
    mood: number | null;
    sleepQuality: number | null;
    disciplineScore: number | null;
    keyLesson: string | null;
    marketBias: string | null;
  }[];
  total: number;
}

export function MentorOwnerView({ ownerId }: { ownerId: string }) {
  const t = useTranslations("mentorSpace");
  const home = useQuery({
    queryKey: ["mentor-space"],
    queryFn: () =>
      apiFetch<{ mentees: MenteeSummaryDTO[] }>("/api/v1/mentor"),
  });
  const mentee = home.data?.mentees.find((m) => m.ownerId === ownerId);

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => navigate("/mentor")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToMentees")}
      </Button>

      {home.isLoading ? (
        <Skeleton className="h-8 w-64" />
      ) : mentee ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5"
          role="status"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("banner", { name: mentee.ownerDisplayName })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {!mentee.permissions.canViewAmounts && (
              <Badge variant="outline">{t("amountsHidden")}</Badge>
            )}
            {mentee.ownerHandle && (
              <span className="font-mono text-xs text-muted-foreground">
                @{mentee.ownerHandle}
              </span>
            )}
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="trades">
        <TabsList>
          <TabsTrigger value="trades">{t("tabs.trades")}</TabsTrigger>
          <TabsTrigger value="journal">{t("tabs.journal")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("tabs.analytics")}</TabsTrigger>
        </TabsList>
        <TabsContent value="trades" className="mt-4">
          <MentorTradesTable ownerId={ownerId} />
        </TabsContent>
        <TabsContent value="journal" className="mt-4">
          <MentorJournalList ownerId={ownerId} />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <MentorAnalyticsCard ownerId={ownerId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MentorTradesTable({ ownerId }: { ownerId: string }) {
  const t = useTranslations("mentorSpace");
  const [page, setPage] = React.useState(1);
  const trades = useQuery({
    queryKey: ["mentor-trades", ownerId, page],
    queryFn: () =>
      apiFetch<MentorTradesPage>(
        `/api/v1/mentor/${ownerId}/trades?page=${page}&pageSize=20`
      ),
    retry: false,
  });

  if (trades.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (trades.error) {
    return <p className="text-sm text-rose-600 dark:text-rose-400">{t("loadError")}</p>;
  }
  const rows = trades.data?.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("tradesEmpty")}</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {rows.map((row) => {
          const r = row as Record<string, string | null>;
          return (
            <li key={String(r.id)}>
              <button
                type="button"
                onClick={() => navigate(`/mentor/${ownerId}/trades/${r.id}`)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{String(r.symbol)}</span>
                  <Badge
                    variant="outline"
                    className={
                      r.direction === "LONG"
                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : "border-rose-500/40 text-rose-700 dark:text-rose-400"
                    }
                  >
                    {String(r.direction)}
                  </Badge>
                  {r.status === "OPEN" && (
                    <Badge variant="secondary">{String(r.status)}</Badge>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {String(r.entryTime).slice(0, 10)}
                  </span>
                  {r.pips != null && (
                    <span
                      className={
                        Number(r.pips) >= 0
                          ? "font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                          : "font-medium tabular-nums text-rose-600 dark:text-rose-400"
                      }
                    >
                      {Number(r.pips) >= 0 ? "+" : ""}
                      {Number(r.pips).toFixed(1)} pips
                    </span>
                  )}
                  {r.rMultiple != null && (
                    <span className="font-medium tabular-nums">
                      {Number(r.rMultiple) >= 0 ? "+" : ""}
                      {Number(r.rMultiple).toFixed(2)} R
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(trades.data?.totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {page} / {trades.data?.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= (trades.data?.totalPages ?? 1)}
            onClick={() => setPage((p) => p + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

function MentorJournalList({ ownerId }: { ownerId: string }) {
  const t = useTranslations("mentorSpace");
  const journal = useQuery({
    queryKey: ["mentor-journal", ownerId],
    queryFn: () => apiFetch<MentorJournal>(`/api/v1/mentor/${ownerId}/journal`),
    retry: false,
  });

  if (journal.isLoading) return <Skeleton className="h-40 w-full" />;
  if (journal.error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
        <EyeOff className="h-4 w-4" aria-hidden="true" />
        {t("journalOff")}
      </div>
    );
  }
  const entries = journal.data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
        <NotebookPen className="h-4 w-4" aria-hidden="true" />
        {t("journalEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <Card key={entry.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              {entry.date}
              <span className="flex gap-1.5 text-xs font-normal text-muted-foreground">
                {entry.mood != null && <span>{t("mood")} {entry.mood}/5</span>}
                {entry.disciplineScore != null && (
                  <span>· {t("discipline")} {entry.disciplineScore}/5</span>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {entry.keyLesson && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{t("keyLesson")} :</span>{" "}
                {entry.keyLesson}
              </p>
            )}
            {entry.postMarketReview && (
              <p className="line-clamp-3 text-muted-foreground">
                {entry.postMarketReview}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MentorAnalyticsCard({ ownerId }: { ownerId: string }) {
  const t = useTranslations("mentorSpace");
  const analytics = useQuery({
    queryKey: ["mentor-analytics", ownerId],
    queryFn: () => apiFetch<MentorAnalytics>(`/api/v1/mentor/${ownerId}/analytics`),
    retry: false,
  });

  if (analytics.isLoading) return <Skeleton className="h-40 w-full" />;
  if (analytics.error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
        <EyeOff className="h-4 w-4" aria-hidden="true" />
        {t("analyticsOff")}
      </div>
    );
  }
  const data = analytics.data;
  if (!data) return null;

  const kpis = (data.kpisAllTime ?? {}) as Record<string, unknown>;
  const stat = (key: string): string => {
    const value = kpis[key];
    return value === undefined || value === null ? "-" : String(value);
  };

  const width = 640;
  const height = 160;
  const points = data.equityCurve;
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, 1);
  const path = points
    .map((p, i) => {
      const x = points.length > 1 ? (i / (points.length - 1)) * width : width / 2;
      const y = height - ((p.value - min) / (max - min || 1)) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Trades" value={String(data.tradeCount)} />
        <MiniStat label="Win rate" value={`${stat("winRate")}%`} />
        <MiniStat label="Profit factor" value={stat("profitFactor")} />
        <MiniStat label="Avg R" value={stat("avgR")} />
      </div>

      {points.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Cumulative P&L - {data.equityUnit === "PERCENT" ? "%" : data.equityUnit}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-40 w-full"
              role="img"
              aria-label="Cumulative P&L curve"
            >
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-emerald-600 dark:text-emerald-400"
              />
            </svg>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
