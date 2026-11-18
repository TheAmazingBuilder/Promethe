"use client";

/**
 * Exits tab — /analytics/exits (v2.5 Module 6).
 *
 * Capture ratio, left on the table, breakdown by exit reason, and exit
 * simulations (fixed TP, trailing, breakeven) compared with real exits.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
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
import { AdvKpi, fmtPctValue, fmtR, fmtRatio } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import { useTradingLabels } from "@/components/trades/trade-bits";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum } from "@/lib/format";

export function ExitsView() {
  const t = useTranslations("analytics.advanced.exits");
  const tRoot = useTranslations("analytics.advanced");
  const labels = useTradingLabels();
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const exits = data?.advanced.exits ?? null;

  return (
    <AdvancedShell
      tab="exits"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={exits != null && exits.total === 0}
      sampleCount={exits?.total ?? null}
    >
      {exits != null ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <AdvKpi
              label={t("kpiCapture")}
              value={fmtRatio(exits.avgCaptureRatio)}
              sub={t("captureNote")}
            />
            <AdvKpi
              label={t("kpiLeft")}
              value={fmtR(exits.avgLeftOnTableR)}
            />
            <AdvKpi
              label={t("kpiWithMfe")}
              value={fmtNum(exits.withMfe, 0)}
              sub={tRoot("sample", { count: exits.total })}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("byReasonTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {exits.byExitReason.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {tRoot("noData")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colReason")}</TableHead>
                        <TableHead className="text-right">
                          {t("colCount")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("colAvgR")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("colAvgCapture")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("colAvgLeft")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exits.byExitReason.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium">
                            {row.key === "UNKNOWN"
                              ? "-"
                              : labels.exitReason(row.key)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtR(row.avgR)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtRatio(row.avgCapture)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtR(row.avgLeftOnTableR)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("simTitle")}</CardTitle>
              <CardDescription>{t("simDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colSim")}</TableHead>
                      <TableHead className="text-right">
                        {t("colTotalR")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colAvgR")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colWinRate")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colTrades")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exits.simulations.map((sim) => (
                      <TableRow
                        key={sim.id}
                        className={
                          sim.id === "real" ? "font-medium" : undefined
                        }
                      >
                        <TableCell>{t(`sim${capitalize(sim.id)}`)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(sim.totalR)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(sim.avgR)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPctValue(sim.winRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {sim.trades}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {tRoot("thresholdsNote")}
              </p>
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
