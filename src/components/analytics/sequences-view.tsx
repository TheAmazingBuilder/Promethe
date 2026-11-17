"use client";

/**
 * Sequences tab — #/analytics/sequences (v2.5 Module 6).
 *
 * Performance after N consecutive wins/losses (binomial test vs the
 * overall win rate) and the win/loss transition matrix.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
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
import { AdvKpi, fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum } from "@/lib/format";

export function SequencesView() {
  const t = useTranslations("analytics.advanced.sequences");
  const tRoot = useTranslations("analytics.advanced");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const seq = data?.advanced.sequences ?? null;

  return (
    <AdvancedShell
      tab="sequences"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={seq != null && seq.total === 0}
      sampleCount={seq?.total ?? null}
    >
      {seq != null ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdvKpi
              label={t("baseline")}
              value={fmtPctValue(seq.baselineWinRate)}
              sub={tRoot("sample", { count: seq.decided })}
            />
            <AdvKpi
              label={t("winAfterWin")}
              value={fmtPctValue(seq.matrix.pWinAfterWin)}
              sub={`${seq.matrix.ww} / ${seq.matrix.ww + seq.matrix.wl}`}
            />
            <AdvKpi
              label={t("winAfterLoss")}
              value={fmtPctValue(seq.matrix.pWinAfterLoss)}
              sub={`${seq.matrix.lw} / ${seq.matrix.lw + seq.matrix.ll}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("afterTitle")}</CardTitle>
              <CardDescription>{t("minSampleNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colSide")}</TableHead>
                      <TableHead className="text-right">
                        {t("colStreak")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colNextTrades")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colNextWinRate")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colNextAvgR")}
                      </TableHead>
                      <TableHead className="text-right">{t("colP")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seq.after.map((row) => (
                      <TableRow key={`${row.side}-${row.streak}`}>
                        <TableCell className="font-medium">
                          {row.side === "WIN" ? t("sideWin") : t("sideLoss")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.streak}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPctValue(row.winRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(row.avgR)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.pValue != null ? (
                            <Badge
                              variant={
                                row.significant ? "destructive" : "outline"
                              }
                            >
                              {fmtNum(row.pValue, 3)}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {t("significant")} · {t("notSignificant")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("matrixTitle")}</CardTitle>
              <CardDescription>{t("matrixNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead aria-label="previous" />
                      <TableHead className="text-right">
                        {t("sideWin")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("sideLoss")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">
                        {t("sideWin")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {seq.matrix.ww}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {seq.matrix.wl}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">
                        {t("sideLoss")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {seq.matrix.lw}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {seq.matrix.ll}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdvancedShell>
  );
}
