"use client";

/**
 * Trader score tab — /analytics/quality (v2.5 Module 6).
 *
 * Composite score 0-100 (discipline / edge / consistency / risk, 25 each),
 * component details and month-end replay history.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AdvancedShell } from "./advanced-shell";
import { AdvKpi, fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";

// Score-history chart (recharts) loads on demand after the score cards.
const ScoreHistoryChart = dynamic(
  () => import("./quality-score-chart").then((m) => m.ScoreHistoryChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full" />,
  }
);

const GRADE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  excellent: "default",
  good: "secondary",
  developing: "outline",
  fragile: "destructive",
};

export function QualityView() {
  const t = useTranslations("analytics.advanced.quality");
  const tRoot = useTranslations("analytics.advanced");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const score = data?.advanced.score ?? null;
  const history = data?.advanced.scoreHistory ?? [];
  const currency = data?.currency ?? "USD";

  const components = score
    ? ([
        {
          key: "discipline",
          value: score.components.discipline,
          desc: t("compDisciplineDesc"),
        },
        {
          key: "edge",
          value: score.components.edge,
          desc: t("compEdgeDesc"),
        },
        {
          key: "consistency",
          value: score.components.consistency,
          desc: t("compConsistencyDesc"),
        },
        {
          key: "risk",
          value: score.components.risk,
          desc: t("compRiskDesc"),
        },
      ] as const)
    : [];

  return (
    <AdvancedShell
      tab="quality"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={score != null && score.trades === 0}
      sampleCount={score?.trades ?? null}
    >
      {score != null ? (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">{t("scoreTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                <p className="text-5xl font-bold tabular-nums">
                  {score.total}
                  <span className="text-2xl text-muted-foreground"> / 100</span>
                </p>
                <Badge variant={GRADE_VARIANT[score.grade]}>
                  {t(`grade${capitalize(score.grade)}`)}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {t("scoreNote")}
                </p>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">
                  {tRoot("tabs.quality")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {components.map((c) => (
                  <div key={c.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">
                        {t(`comp${capitalize(c.key)}`)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmtNum(c.value, 1)} / 25
                      </span>
                    </div>
                    <Progress value={(c.value / 25) * 100} />
                    <p className="text-xs text-muted-foreground">{c.desc}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdvKpi
              label={t("detailPlanRate")}
              value={fmtPctValue(score.details.planRate)}
            />
            <AdvKpi
              label={t("detailViolations")}
              value={fmtNum(score.details.violationCount, 0)}
            />
            <AdvKpi
              label={t("detailExpectancy")}
              value={fmtR(score.details.expectancyR)}
            />
            <AdvKpi
              label={t("detailSqn")}
              value={
                score.details.sqn != null
                  ? fmtNum(score.details.sqn, 2)
                  : "-"
              }
            />
            <AdvKpi
              label={t("detailMonths")}
              value={`${score.details.profitableMonths} / ${score.details.months}`}
            />
            <AdvKpi
              label={t("detailMonthlyStd")}
              value={
                score.details.monthlyRStd != null
                  ? fmtSigned(String(score.details.monthlyRStd))
                  : "-"
              }
            />
            <AdvKpi
              label={t("detailRiskCompliant")}
              value={fmtPctValue(score.details.riskCompliantRate)}
            />
            <AdvKpi
              label={t("detailDrawdown")}
              value={
                <Money
                  value={score.details.maxDrawdown}
                  currency={currency}
                  className={pnlClass(score.details.maxDrawdown)}
                />
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("historyTitle")}</CardTitle>
              <CardDescription>{t("historyNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("historyEmpty")}
                </p>
              ) : (
                <ScoreHistoryChart
                  history={history}
                  label={t("historyTitle")}
                  formatSample={(count) => tRoot("sample", { count })}
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdvancedShell>
  );
}

function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
