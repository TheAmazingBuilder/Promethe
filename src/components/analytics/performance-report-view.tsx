"use client";

/**
 * Performance report tab — /analytics/performance-report (MRT wave 3).
 *
 * A period-scoped report (30d / 90d / YTD / all, one account or all):
 * verdict, week at a glance, P&L by week, where the edge comes from,
 * what costs, three recommendations and the week ahead. The verdict,
 * recommendations and costs come from the weekly plan engine, run on
 * the selected period's trades — same rules, same source as the weekly
 * plan tab. The "Next week" section shows the live weekly plan actions
 * with their Done checkboxes. "Download PDF" builds the PDF with the
 * shared report generator (same engine as the monthly report).
 * No sidebar entry: this is an Analytics tab, like the weekly plan.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, FileDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdvancedShell } from "./advanced-shell";
import { ActionRow } from "./weekly-plan-view";
import { Money } from "@/components/privacy/money";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import {
  usePerformanceReport,
  useToggleWeeklyPlanAction,
} from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { buildPerformancePdf } from "@/lib/reports/performance-pdf";
import { navigate } from "@/lib/router";

const EDGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  yes: "default",
  "not-yet": "secondary",
  no: "destructive",
};

const PERIOD_KEYS: Record<AnalyticsPeriod, string> = {
  "30d": "period30d",
  "90d": "period90d",
  ytd: "periodYtd",
  all: "periodAll",
};

function formatDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatRange(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const parse = (key: string): Date => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  return from === to ? fmt.format(parse(from)) : `${fmt.format(parse(from))} – ${fmt.format(parse(to))}`;
}

export function PerformanceReportView() {
  const t = useTranslations("performanceReport");
  const tAnalytics = useTranslations("analytics");
  const { reducedMotionActive } = useA11yPrefs();
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("30d");
  const [accountId, setAccountId] = React.useState<string>("all");
  const account = accountId === "all" ? undefined : accountId;
  const { data, isLoading, isError, refetch } = usePerformanceReport({
    period,
    account,
  });
  const toggle = useToggleWeeklyPlanAction(account);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [pdfError, setPdfError] = React.useState<string | null>(null);

  const report = data?.report ?? null;
  // Phase 2 perf — the 30d weekly plan rides in the report payload, no
  // second GET /api/weekly-plan for this page.
  const plan = data?.plan ?? null;
  const doneCount = plan?.actions.filter((a) => a.done).length ?? 0;
  const totalCount = plan?.actions.length ?? 0;

  const coverageLine =
    report == null
      ? null
      : report.coverage.from != null && report.coverage.to != null
        ? t("coverage", {
            trades: report.coverage.trades,
            accounts: report.coverage.accounts,
            range: formatRange(report.coverage.from, report.coverage.to),
          })
        : t("coverageNoRange", {
            trades: report.coverage.trades,
            accounts: report.coverage.accounts,
          });

  const downloadPdf = async () => {
    if (data == null || report == null || !report.sufficient) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const generatedLabel = `${t("generatedOn")} ${new Intl.DateTimeFormat(
        "en-CA",
        { dateStyle: "medium" }
      ).format(new Date())}`;
      await buildPerformancePdf(
        data,
        tAnalytics(PERIOD_KEYS[period]),
        coverageLine ?? "",
        generatedLabel,
        plan?.actions ?? [],
        {
          title: t("title"),
          verdict: t("verdictTitle"),
          verdictYes: t("edgeYes"),
          verdictNo: t("edgeNo"),
          verdictNotYet: t("edgeNotYet"),
          expectancy: t("expectancy"),
          sample: t("sample"),
          sqn: t("sqn"),
          glance: t("glanceTitle"),
          netPnl: t("glanceNetPnl"),
          trades: t("glanceTrades"),
          winRate: t("glanceWinRate"),
          profitFactor: t("glanceProfitFactor"),
          planFollowed: t("glancePlanFollowed"),
          discipline: t("glanceDiscipline"),
          weekly: t("weeklyTitle"),
          week: t("weeklyWeek"),
          edgeSources: t("edgeSourcesTitle"),
          source: t("edgeSource"),
          sourceSession: t("edgeSourceSession"),
          sourceSetup: t("edgeSourceSetup"),
          sourceConfluence: t("edgeSourceConfluence"),
          costs: t("costsTitle"),
          costsEmpty: t("costsEmpty"),
          recommendations: t("recommendationsTitle"),
          target: t("target"),
          nextWeek: t("nextWeekTitle"),
          nextWeekEmpty: t("nextWeekEmpty"),
        }
      );
    } catch (err) {
      setPdfError((err as Error).message || t("pdfFailed"));
    } finally {
      setPdfBusy(false);
    }
  };

  const changeAccounts = () => {
    setAccountId("all");
    window.scrollTo({
      top: 0,
      behavior: reducedMotionActive ? "auto" : "smooth",
    });
  };

  return (
    <AdvancedShell
      tab="performance-report"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={false}
      sampleCount={report?.sampleSize ?? null}
    >
      {report == null ? null : !report.sufficient ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("notEnoughTitle")}</CardTitle>
            <CardDescription>
              {t("notEnoughDetail", { count: report.sampleSize, min: 5 })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/trades/new")}>
              {t("logTrade")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Coverage + actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {coverageLine != null ? (
              <p className="text-sm font-medium tabular-nums">{coverageLine}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={changeAccounts}>
                {t("changeAccounts")}
              </Button>
              <Button size="sm" onClick={downloadPdf} disabled={pdfBusy}>
                {pdfBusy ? (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {pdfBusy ? t("downloading") : t("downloadPdf")}
              </Button>
            </div>
          </div>
          {pdfError != null ? (
            <p className="text-sm text-destructive" role="alert">
              {pdfError}
            </p>
          ) : null}

          {/* Verdict */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("verdictTitle")}</CardTitle>
              <CardDescription>{t("verdictDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={EDGE_VARIANT[report.edge.verdict]}>
                {t(
                  report.edge.verdict === "yes"
                    ? "edgeYes"
                    : report.edge.verdict === "no"
                      ? "edgeNo"
                      : "edgeNotYet"
                )}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {report.edge.reason}
              </p>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("expectancy")}
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {report.edge.expectancyR != null
                      ? `${report.edge.expectancyR > 0 ? "+" : ""}${report.edge.expectancyR.toFixed(2)}R`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("sample")}
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {report.edge.sampleSize}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("sqn")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {report.edge.sqn != null ? report.edge.sqn.toFixed(2) : "-"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Week at a glance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("glanceTitle")}</CardTitle>
              <CardDescription>{t("glanceDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceNetPnl")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    <Money
                      value={report.atAGlance.netPnl}
                      currency={data?.currency ?? "USD"}
                      signed
                      maxDigits={0}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceTrades")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.trades}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceWinRate")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.winRate != null
                      ? `${Number(report.atAGlance.winRate).toFixed(1)} %`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceProfitFactor")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.profitFactor ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceExpectancy")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.expectancyR != null
                      ? `${Number(report.atAGlance.expectancyR) > 0 ? "+" : ""}${Number(report.atAGlance.expectancyR).toFixed(2)}R`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glancePlanFollowed")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.planFollowedPct != null
                      ? `${report.atAGlance.planFollowedPct.toFixed(1)} %`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("glanceDiscipline")}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {report.atAGlance.disciplineScore}
                    <span className="text-sm text-muted-foreground"> / 100</span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* P&L by week */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("weeklyTitle")}</CardTitle>
              <CardDescription>{t("weeklyDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {report.weeklyPnl.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("weeklyEmpty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="py-2 pr-2 font-medium">
                          {t("weeklyWeek")}
                        </th>
                        <th
                          scope="col"
                          className="py-2 pr-2 text-right font-medium"
                        >
                          {t("weeklyTrades")}
                        </th>
                        <th
                          scope="col"
                          className="py-2 pr-2 text-right font-medium"
                        >
                          {t("weeklyWinRate")}
                        </th>
                        <th scope="col" className="py-2 text-right font-medium">
                          {t("weeklyNetPnl")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.weeklyPnl.map((week) => {
                        const net = Number(week.netPnl);
                        return (
                          <tr key={week.weekStart} className="border-b last:border-0">
                            <td className="py-2 pr-2 font-medium">
                              {formatDay(week.weekStart)} –{" "}
                              {formatDay(week.weekEnd)}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {week.trades}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {week.winRate != null
                                ? `${week.winRate.toFixed(1)} %`
                                : "-"}
                            </td>
                            <td
                              className={
                                "py-2 text-right font-semibold tabular-nums " +
                                (net > 0
                                  ? "text-gain"
                                  : net < 0
                                    ? "text-loss"
                                    : "")
                              }
                            >
                              <Money
                                value={week.netPnl}
                                currency={data?.currency ?? "USD"}
                                signed
                                maxDigits={0}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Where the edge comes from */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("edgeSourcesTitle")}
              </CardTitle>
              <CardDescription>{t("edgeSourcesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {report.edgeSources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("edgeSourcesEmpty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {report.edgeSources.map((source) => (
                    <li
                      key={`${source.kind}-${source.name}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border p-4 text-sm"
                    >
                      <Badge variant="secondary">
                        {t(
                          source.kind === "session"
                            ? "edgeSourceSession"
                            : source.kind === "setup"
                              ? "edgeSourceSetup"
                              : "edgeSourceConfluence"
                        )}
                      </Badge>
                      <span className="font-semibold">{source.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {t("sampleTrades", { count: source.trades })}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {source.winRate != null
                          ? t("winRate", { value: source.winRate })
                          : t("winRateUnknown")}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {t("avgR", {
                          value:
                            source.expectancyR != null
                              ? `${source.expectancyR > 0 ? "+" : ""}${source.expectancyR.toFixed(2)}`
                              : "-",
                        })}
                      </span>
                      <span className="ml-auto font-semibold tabular-nums">
                        <Money
                          value={source.netPnl}
                          currency={data?.currency ?? "USD"}
                          signed
                          maxDigits={0}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* What costs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("costsTitle")}</CardTitle>
              <CardDescription>{t("costsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {report.costs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("costsEmpty")}
                </p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {report.costs.map((cost) => (
                    <li key={cost}>{cost}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("recommendationsTitle")}
              </CardTitle>
              <CardDescription>{t("recommendationsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {report.recommendations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("recommendationsEmpty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {report.recommendations.map((action) => (
                    <li
                      key={action.rule}
                      className="rounded-lg border p-4 text-sm"
                    >
                      <p className="font-semibold leading-snug">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
                          {action.rank}
                        </span>
                        {action.title}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {action.evidence.label}:{" "}
                        <Money
                          value={action.evidence.netPnl}
                          currency={action.evidence.currency}
                          signed
                          maxDigits={0}
                        />
                        {action.evidence.suffix ?? ""}
                      </p>
                      <p className="mt-1 text-xs">
                        <span className="font-medium">{t("target")}: </span>
                        {action.target}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Next week (live weekly plan, with checkboxes) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("nextWeekTitle")}</CardTitle>
              <CardDescription>
                {plan != null
                  ? t("nextWeekDesc", {
                      start: formatDay(plan.weekStart),
                      end: formatDay(plan.weekEnd),
                      done: doneCount,
                      total: totalCount,
                    })
                  : t("nextWeekDescLoading")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : plan == null || plan.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("nextWeekEmpty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {plan.actions.map((action) => (
                    <ActionRow
                      key={action.rule}
                      action={action}
                      pending={toggle.isPending}
                      onToggle={(rule, done) => toggle.mutate({ rule, done })}
                    />
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/analytics/weekly-plan")}
              >
                {t("openWeeklyPlan")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{t("methodNote")}</p>
        </div>
      )}
    </AdvancedShell>
  );
}
