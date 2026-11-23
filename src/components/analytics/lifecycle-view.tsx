"use client";

/**
 * Lifecycle tab — /analytics/lifecycle (v2.5 Module 6).
 *
 * MFE/MAE distributions in R, almost-TP cases, and time in profit/loss
 * (from stored candles when coverage allows).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
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
import {
  AdvKpi,
  BucketBars,
  fmtPctValue,
  fmtR,
} from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtDateInTz, fmtNum } from "@/lib/format";
import { navigate } from "@/lib/router";

function bucketLabel(b: { from: number | null; to: number | null }): string {
  if (b.from == null) return `< ${b.to} R`;
  if (b.to == null) return `≥ ${b.from} R`;
  return `${b.from} - ${b.to} R`;
}

export function LifecycleView() {
  const t = useTranslations("analytics.advanced.lifecycle");
  const tRoot = useTranslations("analytics.advanced");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics(
    {
      period,
      account: accountId === "all" ? undefined : accountId,
    },
    "lifecycle"
  );
  const lifecycle = data?.advanced.lifecycle ?? null;
  const timezone = data?.timezone ?? "UTC";

  return (
    <AdvancedShell
      tab="lifecycle"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={lifecycle != null && lifecycle.total === 0}
      sampleCount={lifecycle?.total ?? null}
    >
      {lifecycle != null ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdvKpi label={t("kpiAvgMfe")} value={fmtR(lifecycle.avgMfeR)} />
            <AdvKpi label={t("kpiAvgMae")} value={fmtR(lifecycle.avgMaeR)} />
            <AdvKpi
              label={t("kpiAlmostTp")}
              value={fmtNum(lifecycle.almostTpCount, 0)}
              sub={tRoot("sample", { count: lifecycle.withMfe })}
            />
            <AdvKpi
              label={t("kpiCoverage")}
              value={
                lifecycle.total === 0
                  ? "-"
                  : fmtPctValue((lifecycle.withMfe / lifecycle.total) * 100)
              }
              sub={t("kpiTimeInProfit")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdvKpi
              label={t("kpiMedianMfe")}
              value={fmtR(lifecycle.medianMfeR)}
            />
            <AdvKpi
              label={t("kpiMedianMae")}
              value={fmtR(lifecycle.medianMaeR)}
            />
            <AdvKpi
              label={t("kpiTimeInProfit")}
              value={fmtPctValue(lifecycle.avgTimeInProfitPct)}
              sub={tRoot("sample", { count: lifecycle.withTimeData })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("mfeTitle")}</CardTitle>
                <CardDescription>
                  {tRoot("sample", { count: lifecycle.withMfe })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BucketBars
                  buckets={lifecycle.mfeBuckets}
                  formatLabel={bucketLabel}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("maeTitle")}</CardTitle>
                <CardDescription>
                  {tRoot("sample", { count: lifecycle.withMae })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BucketBars
                  buckets={lifecycle.maeBuckets}
                  formatLabel={bucketLabel}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("almostTpTitle")} ({lifecycle.almostTpCount})
              </CardTitle>
              <CardDescription>{t("almostTpNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              {lifecycle.almostTp.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("almostTpEmpty")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colTrade")}</TableHead>
                        <TableHead>{t("colSymbol")}</TableHead>
                        <TableHead>{t("colDate")}</TableHead>
                        <TableHead className="text-right">{t("colMfe")}</TableHead>
                        <TableHead className="text-right">
                          {t("colPlanned")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("colRealized")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("colTimeProfit")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lifecycle.almostTp.map((row) => (
                        <TableRow key={row.tradeId}>
                          <TableCell>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() =>
                                navigate(`/trades/${row.tradeId}`)
                              }
                            >
                              {row.tradeId.slice(0, 8)}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.symbol}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {fmtDateInTz(row.exitTime, timezone)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtR(row.mfeR)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.plannedRR != null
                              ? `${fmtNum(row.plannedRR, 2)} R`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtR(row.realizedR)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.timeInProfitPct != null
                              ? fmtPctValue(row.timeInProfitPct)
                              : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {t("timeNote")}
              </p>
              {lifecycle.withMfe < lifecycle.total ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("noMfeNote")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdvancedShell>
  );
}
