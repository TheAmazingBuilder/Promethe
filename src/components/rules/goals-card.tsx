"use client";

/**
 * Dashboard goals widget (v1 phase 6) — active goals with live progress
 * bars. Hidden when the user has no ACTIVE goal. Data: GET /api/goals.
 */
import { Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/app/session-context";
import { selectActiveGoals, useGoals } from "@/hooks/use-goals";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import {
  formatGoalValue,
  goalBarTone,
} from "@/components/rules/goal-format";

export function GoalsCard() {
  const t = useTranslations("dashboard.goalsCard");
  const tGoals = useTranslations("goalsView");
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const { data, isLoading } = useGoals();
  const fmt = useFormat();

  // Quietly hidden while loading / empty / on error.
  if (isLoading) {
    return <Skeleton className="h-28 w-full rounded-xl" aria-hidden="true" />;
  }
  const active = selectActiveGoals(data);
  if (data == null || active.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("title")}
        </CardTitle>
        <CardDescription className="tabular-nums">
          {t("count", { count: active.length })}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/rules")}
          >
            {t("manage")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.slice(0, 4).map((g) => (
          <div key={g.id} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-medium">{g.name}</p>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatGoalValue(fmt, g.metric, g.progress.currentValue, currency)}
                {" / "}
                {formatGoalValue(fmt, g.metric, g.progress.targetValue, currency)}
                {" · "}
                {tGoals(`period.${g.period}`)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${goalBarTone(
                    g.progress.progressPercent,
                    g.progress.isAchieved
                  )}`}
                  style={{ width: `${Math.max(2, g.progress.progressPercent)}%` }}
                  role="progressbar"
                  aria-valuenow={g.progress.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={g.name}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                {Math.round(g.progress.progressPercent)}%
              </span>
            </div>
          </div>
        ))}
        {active.length > 4 && (
          <p className="text-xs text-muted-foreground">
            {t("more", { count: active.length - 4 })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
