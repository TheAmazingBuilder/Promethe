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
  // Same honest qualification as the Analytics KPI strip (MD §3.4).
  const tAnalytics = useTranslations("analytics");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics(
    {
      period,
      account: accountId === "all" ? undefined : accountId,
    },
    "score"
  );
  const score = data?.advanced.score ?? null;
  const reviews = data?.advanced.reviews ?? null;
  const history = data?.advanced.scoreHistory ?? [];
  const currency = data?.currency ?? "USD";
  // The score's real period: the validated period the server actually
  // used (never the requested label alone) plus its source — the frozen
  // daily snapshot for all-time, a fresh recompute otherwise.
  const scorePeriodKey = {
    "30d": "scorePeriod30d",
    "90d": "scorePeriod90d",
    ytd: "scorePeriodYtd",
    all: "scorePeriodAll",
  } as const;
  const scorePeriodNote =
    score?.source === "snapshot"
      ? t("scoreSnapshotNote")
      : t(scorePeriodKey[data?.period ?? period]);

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
                  {scorePeriodNote}
                </p>
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
                  ? fmtNum(String(score.details.monthlyRStd), 2)
                  : "-"
              }
            />
            <AdvKpi
              label={t("detailRiskCompliant")}
              value={fmtPctValue(score.details.riskCompliantRate)}
            />
            <AdvKpi
              label={t("detailDrawdown")}
              sub={tAnalytics("kpiDrawdownHint")}
              value={
                <Money
                  value={score.details.maxDrawdown}
                  currency={currency}
                  className={pnlClass(score.details.maxDrawdown)}
                />
              }
            />
          </div>

          {reviews != null ? (
            <section className="space-y-4" aria-labelledby="review-analytics-title">
              <div>
                <h2 id="review-analytics-title" className="text-base font-semibold">{t("reviewsTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("reviewsDesc")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <AdvKpi label={t("reviewCoverage")} value={fmtPctValue(reviews.coveragePct)} />
                <AdvKpi label={t("reviewedTrades")} value={`${reviews.reviewedTrades} / ${reviews.closedTrades}`} />
                <AdvKpi label={t("reviewPlanRate")} value={fmtPctValue(reviews.plan.ratePct)} />
                <AdvKpi label={t("reviewPlanAnswers")} value={`${reviews.plan.followed} / ${reviews.plan.followed + reviews.plan.notFollowed}`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("reviewScoresTitle")}</CardTitle>
                    <CardDescription>{t("reviewScoresDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {([
                      ["planAdherence", reviews.scores.planAdherence],
                      ["execution", reviews.scores.execution],
                      ["entry", reviews.scores.entry],
                      ["exit", reviews.scores.exit],
                      ["riskManagement", reviews.scores.riskManagement],
                      ["emotionalControl", reviews.scores.emotionalControl],
                    ] as const).map(([key, metric]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span>{t(`reviewScore.${key}`)}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {metric.average == null ? "—" : `${fmtNum(metric.average, 2)} / 5`}
                            <span className="ml-2 text-xs">({metric.count})</span>
                          </span>
                        </div>
                        <Progress value={metric.average == null ? 0 : (metric.average / 5) * 100} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("reviewDecisionsTitle")}</CardTitle>
                    <CardDescription>{t("reviewDecisionsDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-xl font-semibold tabular-nums">{reviews.wouldTakeAgain.yes}</p><p className="text-xs text-muted-foreground">{t("reviewYes")}</p></div>
                      <div><p className="text-xl font-semibold tabular-nums">{reviews.wouldTakeAgain.no}</p><p className="text-xs text-muted-foreground">{t("reviewNo")}</p></div>
                      <div><p className="text-xl font-semibold tabular-nums">{reviews.wouldTakeAgain.maybe}</p><p className="text-xs text-muted-foreground">{t("reviewMaybe")}</p></div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("reviewPlaybookTitle")}</p>
                      {([
                        ["MATCHED", reviews.playbookMatch.matched],
                        ["PARTIAL", reviews.playbookMatch.partial],
                        ["OFF_PLAYBOOK", reviews.playbookMatch.offPlaybook],
                      ] as const).map(([key, count]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <span>{t(`playbook.${key}`)}</span><span className="tabular-nums text-muted-foreground">{count}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("reviewMistakesTitle")}</CardTitle>
                  <CardDescription>{t("reviewMistakesDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {reviews.topMistakes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("reviewMistakesEmpty")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {reviews.topMistakes.map((mistake) => (
                        <Badge key={mistake.label} variant="outline">
                          {mistake.label} · {mistake.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              {reviews.customQuestions.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("customQuestionsTitle")}</CardTitle>
                    <CardDescription>{t("customQuestionsDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {reviews.customQuestions.map((metric) => (
                      <div key={JSON.stringify([metric.questionId, metric.question, metric.type])} className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-medium">{metric.question}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {metric.type === "SCALE" ? (
                            <>
                              <span>{t("customQuestionAverage")}: {metric.average == null ? "—" : `${fmtNum(metric.average, 2)} / 5`}</span>
                              <span>·</span>
                              <span>{t("customQuestionAnswers", { count: metric.answered })}</span>
                            </>
                          ) : metric.type === "BOOLEAN" ? (
                            <>
                              <span>{t("customQuestionYes", { count: metric.booleanYes })}</span>
                              <span>·</span>
                              <span>{t("customQuestionNo", { count: metric.booleanNo })}</span>
                            </>
                          ) : <span>{t("customQuestionTextAnswers", { count: metric.answered })}</span>}
                        </div>
                        {metric.type === "SCALE" ? (
                          <div className="flex flex-wrap gap-1" aria-label={t("customQuestionScaleDistribution")}>
                            {metric.scaleDistribution.map((count, index) => (
                              <Badge key={index} variant="outline">{index + 1}: {count}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </section>
          ) : null}

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
