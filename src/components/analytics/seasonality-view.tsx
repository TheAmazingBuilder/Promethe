"use client";

/**
 * Seasonality tab — #/analytics/seasonality (v2.5 Module 6).
 *
 * Month / quarter / day-of-month / ISO week breakdowns with Wilson
 * intervals, verdicts under a minimum sample, and a year x month heatmap.
 * An explicit multiple-comparisons warning is shown: with many cells,
 * some differences are expected by chance alone.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import { useI18n } from "@/i18n/i18n-provider";
import type { SeasonCell } from "@/lib/analytics/advanced";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum } from "@/lib/format";
import { Money } from "@/components/privacy/money";

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  positive: "default",
  negative: "destructive",
  neutral: "secondary",
  insufficient: "outline",
};

function wilsonLabel(cell: SeasonCell): string {
  if (cell.wilsonLower == null || cell.wilsonUpper == null) return "-";
  return `${fmtNum(cell.wilsonLower, 1)} - ${fmtNum(cell.wilsonUpper, 1)} %`;
}

export function SeasonalityView() {
  const t = useTranslations("analytics.advanced.seasonality");
  const tRoot = useTranslations("analytics.advanced");
  const { locale } = useI18n();
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const season = data?.advanced.seasonality ?? null;
  const currency = data?.currency ?? "USD";

  const monthName = React.useCallback(
    (month: number) => {
      try {
        return new Intl.DateTimeFormat(locale, { month: "long" }).format(
          new Date(Date.UTC(2024, month - 1, 1))
        );
      } catch {
        return String(month);
      }
    },
    [locale]
  );

  const seasonTable = (cells: SeasonCell[], labelOf: (c: SeasonCell) => string) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colCell")}</TableHead>
            <TableHead className="text-right">{t("colCount")}</TableHead>
            <TableHead className="text-right">{t("colWinRate")}</TableHead>
            <TableHead className="text-right">{t("colWilson")}</TableHead>
            <TableHead className="text-right">{t("colAvgR")}</TableHead>
            <TableHead className="text-right">{t("colNetPnl")}</TableHead>
            <TableHead>{t("colVerdict")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cells.map((cell) => (
            <TableRow key={cell.key}>
              <TableCell className="font-medium">{labelOf(cell)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {cell.count}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtPctValue(cell.winRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {wilsonLabel(cell)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtR(cell.avgR)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Money signed value={cell.netPnl} currency={currency} />
              </TableCell>
              <TableCell>
                <Badge variant={VERDICT_VARIANT[cell.verdict]}>
                  {t(`verdict${capitalize(cell.verdict)}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <AdvancedShell
      tab="seasonality"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={season != null && season.total === 0}
      sampleCount={season?.total ?? null}
    >
      {season != null ? (
        <div className="space-y-6">
          <Alert>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>{t("multipleNote")}</AlertTitle>
            <AlertDescription>{t("minSampleNote")}</AlertDescription>
          </Alert>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("monthsTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {seasonTable(season.months, (c) =>
                  monthName(Number(c.key))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("quartersTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {seasonTable(season.quarters, (c) => c.label)}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("daysTitle")}</CardTitle>
              <CardDescription>{t("minSampleNote")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-8">
                {season.daysOfMonth.map((cell) => (
                  <div
                    key={cell.key}
                    className={`flex flex-col items-center rounded-md border px-1 py-2 text-center ${
                      cell.verdict === "positive"
                        ? "border-gain-subtle bg-gain-subtle"
                        : cell.verdict === "negative"
                          ? "border-loss-subtle bg-loss-subtle"
                          : ""
                    }`}
                    title={`${cell.label}: ${cell.count} trades, ${fmtR(cell.avgR)}`}
                  >
                    <span className="text-xs font-medium">{cell.label}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      ×{cell.count}
                    </span>
                    <span className="text-[11px] tabular-nums">
                      {fmtR(cell.avgR, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("weeksTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {seasonTable(season.weeks, (c) => c.label)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("heatmapTitle")}
                </CardTitle>
                <CardDescription>
                  {tRoot("sample", { count: season.total })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {season.years.map((year) => (
                    <div key={year}>
                      <p className="mb-1 text-xs font-medium tabular-nums">
                        {year}
                      </p>
                      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(
                          (month) => {
                            const cell = season.yearMonth.find(
                              (c) => c.year === year && c.month === month
                            );
                            const avgR = cell?.avgR;
                            return (
                              <div
                                key={month}
                                className={`flex flex-col items-center rounded-md border px-1 py-2 text-center ${
                                  avgR != null && avgR > 0
                                    ? "border-gain-subtle bg-gain-subtle"
                                    : avgR != null && avgR < 0
                                      ? "border-loss-subtle bg-loss-subtle"
                                      : ""
                                }`}
                                title={
                                  cell
                                    ? `${monthName(month)} ${year}: ${cell.count} trades, ${fmtR(cell.avgR)}`
                                    : `${monthName(month)} ${year}`
                                }
                              >
                                <span className="text-[11px] font-medium">
                                  {monthName(month).slice(0, 3)}
                                </span>
                                <span className="text-[11px] tabular-nums">
                                  {avgR != null ? fmtR(avgR, 1) : "-"}
                                </span>
                                <span className="text-[10px] tabular-nums text-muted-foreground">
                                  ×{cell?.count ?? 0}
                                </span>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </AdvancedShell>
  );
}

function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
