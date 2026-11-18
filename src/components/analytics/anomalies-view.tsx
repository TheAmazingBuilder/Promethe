"use client";

/**
 * Anomalies tab — /analytics/anomalies (v2.5 Module 6).
 *
 * Robust MAD z-scores on R and on log holding time. Flags are for review
 * only: no alert is ever raised when a trade is opened.
 */
import * as React from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdvancedShell } from "./advanced-shell";
import { AdvKpi, fmtDurationMin, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtDateInTz, fmtNum } from "@/lib/format";
import { navigate } from "@/lib/router";

export function AnomaliesView() {
  const t = useTranslations("analytics.advanced.anomalies");
  const tRoot = useTranslations("analytics.advanced");
  const tAnalytics = useTranslations("analytics");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const anomalies = data?.advanced.anomalies ?? null;
  const timezone = data?.timezone ?? "UTC";
  const fmtMinutes = React.useCallback(
    (m: number) => tAnalytics("durationM", { m }),
    [tAnalytics]
  );
  const fmtHoursMinutes = React.useCallback(
    (h: number, m: number) => tAnalytics("durationHm", { h, m }),
    [tAnalytics]
  );

  return (
    <AdvancedShell
      tab="anomalies"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={anomalies != null && anomalies.total === 0}
      sampleCount={anomalies?.total ?? null}
    >
      {anomalies != null ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdvKpi
              label={t("kpiHigh")}
              value={fmtNum(anomalies.high, 0)}
            />
            <AdvKpi
              label={t("kpiModerate")}
              value={fmtNum(anomalies.moderate, 0)}
            />
            <AdvKpi
              label={t("kpiTotal")}
              value={fmtNum(anomalies.total, 0)}
              sub={tRoot("sample", { count: anomalies.withR })}
            />
            <AdvKpi
              label={t("rMedian")}
              value={fmtR(anomalies.rMedian)}
              sub={
                anomalies.rMad != null
                  ? `${t("rMad")}: ${fmtNum(anomalies.rMad, 2)}`
                  : undefined
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("tableTitle")} ({anomalies.anomalies.length})
              </CardTitle>
              <CardDescription>{t("methodNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              {anomalies.anomalies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("tableEmpty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colTrade")}</TableHead>
                        <TableHead>{t("colKind")}</TableHead>
                        <TableHead>{t("colSeverity")}</TableHead>
                        <TableHead className="text-right">{t("colZ")}</TableHead>
                        <TableHead className="text-right">{t("colR")}</TableHead>
                        <TableHead className="text-right">
                          {t("colDuration")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anomalies.anomalies.map((a) => (
                        <TableRow key={`${a.tradeId}-${a.kind}`}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto w-fit p-0"
                                onClick={() =>
                                  navigate(`/trades/${a.tradeId}`)
                                }
                              >
                                {a.symbol}
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                {fmtDateInTz(a.exitTime, timezone)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {a.kind === "R_OUTLIER"
                              ? t("kindROutlier")
                              : t("kindDurationOutlier")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                a.severity === "high"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {a.severity === "high"
                                ? t("sevHigh")
                                : t("sevModerate")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNum(a.zScore, 2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtR(a.rMultiple)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtDurationMin(
                              a.durationMin,
                              fmtMinutes,
                              fmtHoursMinutes
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {t("noAlertNote")}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdvancedShell>
  );
}
