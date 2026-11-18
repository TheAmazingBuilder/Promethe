"use client";

/**
 * Habits at a glance widget (MRT wave 2, chantier 2) — win rate by
 * session, all time, on the dashboard.
 *
 * No new calculation: the session breakdown comes straight from GET
 * /api/v1/analytics?period=all (computeBreakdowns, the same payload as
 * /analytics). Grades are NOT shown: they do not exist in Promethe yet,
 * so the widget shows the session only, with the trade count behind
 * every win rate. Each row links to the trades list filtered on that
 * session. No closed trades → an honest empty state, never a
 * placeholder rate. Self-fetching (hasLoader: false).
 */
import { useTranslations } from "next-intl";
import { ChevronRight, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/use-trading";
import { sessionLabel } from "@/lib/analytics/weekly-plan";
import { fmtNum } from "@/lib/format";
import { navigate } from "@/lib/router";

export function HabitsAtAGlanceWidget() {
  const t = useTranslations("habitsAtAGlance");
  const { data, isLoading, isError } = useAnalytics({ period: "all" });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) return null;

  const sessions = [...(data.breakdowns?.session ?? [])]
    .filter((g) => g.stats.tradeCount > 0)
    .sort((a, b) => b.stats.tradeCount - a.stats.tradeCount);
  const totalTrades = sessions.reduce(
    (acc, g) => acc + g.stats.tradeCount,
    0
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("title")}
        </CardTitle>
        <CardDescription>
          {totalTrades > 0
            ? t("descWithSample", { n: totalTrades })
            : t("desc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((group) => {
              const winRate =
                group.stats.winRate != null
                  ? Number(group.stats.winRate)
                  : null;
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/trades?session=${encodeURIComponent(group.key)}`
                      )
                    }
                    aria-label={t("viewSession", {
                      session: sessionLabel(group.key),
                    })}
                    className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 motion-reduce:transition-none"
                  >
                    <span className="w-24 shrink-0 truncate text-sm font-medium">
                      {sessionLabel(group.key)}
                    </span>
                    <Progress
                      value={winRate ?? 0}
                      className="min-w-0 flex-1"
                    />
                    <span className="shrink-0 text-sm tabular-nums">
                      {winRate != null
                        ? `${fmtNum(winRate, 1)}%`
                        : t("noDecided")}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">
                      {t("trades", { n: group.stats.tradeCount })}
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
