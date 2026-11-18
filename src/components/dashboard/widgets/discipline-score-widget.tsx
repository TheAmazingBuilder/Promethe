"use client";

/**
 * Discipline score widget (Phase 2) — surfaces the existing
 * computeTraderScore (0–100, four pillars) on the dashboard.
 *
 * No new calculation: the score, its four pillars and the monthly
 * history come straight from GET /api/v1/analytics/advanced, the same
 * payload as /analytics/quality. No closed trades → an honest empty
 * state, never a placeholder score. Self-fetching (hasLoader: false).
 */
import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import { navigate } from "@/lib/router";
import { fmtNum } from "@/lib/format";

const GRADE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  excellent: "default",
  good: "secondary",
  developing: "outline",
  fragile: "destructive",
};

export function DisciplineScoreWidget() {
  const t = useTranslations("analytics.advanced.quality");
  const tRisk = useTranslations("riskReward");
  const { data, isLoading, isError } = useAdvancedAnalytics(
    { period: "all" },
    "score"
  );

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

  const score = data.advanced.score;
  const history = data.advanced.scoreHistory ?? [];
  const recent = history.slice(-6);

  if (score.trades === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {tRisk("scoreWidgetTitle")}
          </CardTitle>
          <CardDescription>{tRisk("scoreWidgetEmpty")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pillars = [
    { key: "discipline", value: score.components.discipline },
    { key: "edge", value: score.components.edge },
    { key: "consistency", value: score.components.consistency },
    { key: "risk", value: score.components.risk },
  ] as const;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {tRisk("scoreWidgetTitle")}
        </CardTitle>
        <CardDescription>
          {tRisk("scoreWidgetDesc", { n: score.trades })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-semibold tabular-nums">
            {fmtNum(score.total, 0)}
            <span className="text-base font-normal text-muted-foreground">
              /100
            </span>
          </p>
          <Badge variant={GRADE_VARIANT[score.grade] ?? "outline"}>
            {t(`grade${score.grade === "excellent" ? "Excellent" : score.grade === "good" ? "Good" : score.grade === "developing" ? "Developing" : "Fragile"}`)}
          </Badge>
        </div>
        <div className="space-y-2">
          {pillars.map((p) => (
            <div key={p.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  {t(
                    `comp${p.key === "discipline" ? "Discipline" : p.key === "edge" ? "Edge" : p.key === "consistency" ? "Consistency" : "Risk"}`
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtNum(p.value, 1)}/25
                </span>
              </div>
              <Progress value={(p.value / 25) * 100} />
            </div>
          ))}
        </div>
        {recent.length > 1 ? (
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground">
              {tRisk("scoreWidgetHistory")}
            </p>
            <ul className="space-y-1">
              {recent.map((point) => (
                <li
                  key={point.month}
                  className="flex justify-between text-xs tabular-nums"
                >
                  <span className="text-muted-foreground">{point.month}</span>
                  <span>
                    {fmtNum(point.score, 0)}/100 · {point.trades}{" "}
                    {tRisk("scoreWidgetTrades")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/analytics/quality")}
        >
          {tRisk("scoreWidgetDetails")}
        </Button>
      </CardContent>
    </Card>
  );
}
