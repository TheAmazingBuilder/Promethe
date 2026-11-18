"use client";

/**
 * Top 3 leaks widget (MRT wave 2, chantier 2) — the three biggest money
 * leaks from the weekly improvement plan, on the dashboard.
 *
 * No new calculation: the actions come straight from GET
 * /api/v1/weekly-plan (the rule engine in src/lib/analytics/weekly-plan.ts
 * already ranks them by money lost, biggest leak first). Each leak links
 * to its filtered trades when the plan carries an exact drill-down, else
 * to the full plan. Under five trades the widget says so plainly and
 * shows no leak. Self-fetching (hasLoader: false).
 */
import { useTranslations } from "next-intl";
import { ChevronRight, TrendingDown } from "lucide-react";
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
import { useWeeklyPlan } from "@/hooks/use-trading";
import { navigate } from "@/lib/router";

export function TopLeaksWidget() {
  const t = useTranslations("topLeaks");
  const { data, isLoading, isError } = useWeeklyPlan();

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

  const plan = data.plan;
  const leaks = plan.actions.slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t("title")}
        </CardTitle>
        <CardDescription>
          {plan.sufficient
            ? t("descWithSample", { n: plan.sampleSize })
            : t("desc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!plan.sufficient ? (
          <p className="text-sm text-muted-foreground">
            {t("empty", { n: plan.sampleSize })}
          </p>
        ) : leaks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noLeaks")}</p>
        ) : (
          <ul className="space-y-2">
            {leaks.map((action) => (
              <li key={action.rule}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      action.drilldown?.href ?? "/analytics/weekly-plan"
                    )
                  }
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 motion-reduce:transition-none"
                >
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
                    {action.rank}
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm font-semibold leading-snug">
                      {action.title}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {action.evidence.label}:{" "}
                      <span className="text-loss">
                        <Money
                          value={action.evidence.netPnl}
                          currency={action.evidence.currency}
                          signed
                          maxDigits={0}
                        />
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {plan.sufficient ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/analytics/weekly-plan")}
          >
            {t("seePlan")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
