"use client";

/**
 * Setup ranking tab — #/analytics/setups (v2.5 Module 6).
 *
 * Expectancy per setup with Wilson intervals, categories (proven /
 * promising / unproven / losing), per-setup detail and two-setup compare.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdvancedShell } from "./advanced-shell";
import { AdvKpi, fmtDurationMin, fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import type { SetupRank } from "@/lib/analytics/advanced";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum } from "@/lib/format";
import { Money } from "@/components/privacy/money";

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  proven: "default",
  promising: "secondary",
  unproven: "outline",
  losing: "destructive",
};

function wilsonLabel(rank: SetupRank): string {
  if (rank.wilsonLower == null || rank.wilsonUpper == null) return "-";
  return `${fmtNum(rank.wilsonLower, 1)} - ${fmtNum(rank.wilsonUpper, 1)} %`;
}

export function SetupsView() {
  const t = useTranslations("analytics.advanced.setups");
  const tRoot = useTranslations("analytics.advanced");
  const tAnalytics = useTranslations("analytics");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [compareA, setCompareA] = React.useState<string>("");
  const [compareB, setCompareB] = React.useState<string>("");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const setups = data?.advanced.setups ?? [];
  const currency = data?.currency ?? "USD";
  const selected = setups.find((s) => s.key === selectedKey) ?? null;
  const a = setups.find((s) => s.key === compareA) ?? null;
  const b = setups.find((s) => s.key === compareB) ?? null;
  const fmtMinutes = React.useCallback(
    (m: number) => tAnalytics("durationM", { m }),
    [tAnalytics]
  );
  const fmtHoursMinutes = React.useCallback(
    (h: number, m: number) => tAnalytics("durationHm", { h, m }),
    [tAnalytics]
  );

  const setupLabel = (key: string) =>
    key === "__none__" ? t("noSetup") : key;

  return (
    <AdvancedShell
      tab="setups"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={setups.length === 0}
      sampleCount={
        setups.reduce((acc, s) => acc + s.count, 0) || null
      }
    >
      <div className="space-y-6">
        <p className="text-xs text-muted-foreground">
          {t("thresholdsNote")}
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <CardDescription>
              {tRoot("sample", {
                count: setups.reduce((acc, s) => acc + s.count, 0),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {setups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tRoot("noData")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colSetup")}</TableHead>
                      <TableHead className="text-right">
                        {t("colCount")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colExpectancy")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colWinRate")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colWilson")}
                      </TableHead>
                      <TableHead>{t("colCategory")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setups.map((s) => (
                      <TableRow
                        key={s.key}
                        className="cursor-pointer"
                        onClick={() => setSelectedKey(s.key)}
                      >
                        <TableCell className="font-medium">
                          {setupLabel(s.key)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(s.expectancy)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPctValue(s.winRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {wilsonLabel(s)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={CATEGORY_VARIANT[s.category]}>
                            {t(`cat${capitalize(s.category)}`)}
                          </Badge>
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
            <CardTitle className="text-base">{t("detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {selected == null ? (
              <p className="text-sm text-muted-foreground">
                {t("detailEmpty")}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-base font-semibold">
                  {setupLabel(selected.key)}{" "}
                  <Badge variant={CATEGORY_VARIANT[selected.category]}>
                    {t(`cat${capitalize(selected.category)}`)}
                  </Badge>
                </p>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <AdvKpi
                    label={t("colExpectancy")}
                    value={fmtR(selected.expectancy)}
                  />
                  <AdvKpi
                    label={t("colTotalR")}
                    value={fmtR(selected.totalR)}
                  />
                  <AdvKpi
                    label={t("colNetPnl")}
                    value={
                      <Money
                        signed
                        value={selected.netPnl}
                        currency={currency}
                      />
                    }
                  />
                  <AdvKpi
                    label={t("colAvgDuration")}
                    value={fmtDurationMin(
                      selected.avgDurationMin,
                      fmtMinutes,
                      fmtHoursMinutes
                    )}
                  />
                  <AdvKpi
                    label={t("colWinRate")}
                    value={fmtPctValue(selected.winRate)}
                    sub={wilsonLabel(selected)}
                  />
                  <AdvKpi
                    label={t("colAvgQuality")}
                    value={
                      selected.avgSetupQuality != null
                        ? `${fmtNum(selected.avgSetupQuality, 1)} / 5`
                        : "-"
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("compareTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Select value={compareA} onValueChange={setCompareA}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("compareA")} />
                </SelectTrigger>
                <SelectContent>
                  {setups.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {setupLabel(s.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={compareB} onValueChange={setCompareB}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("compareB")} />
                </SelectTrigger>
                <SelectContent>
                  {setups.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {setupLabel(s.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {a == null || b == null || a.key === b.key ? (
              <p className="text-sm text-muted-foreground">
                {t("compareEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colSetup")}</TableHead>
                      <TableHead className="text-right">
                        {t("colCount")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colExpectancy")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colWinRate")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colTotalR")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("colNetPnl")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[a, b].map((s) => (
                      <TableRow key={s.key}>
                        <TableCell className="font-medium">
                          {setupLabel(s.key)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(s.expectancy)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPctValue(s.winRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(s.totalR)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Money signed value={s.netPnl} currency={currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdvancedShell>
  );
}

function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
