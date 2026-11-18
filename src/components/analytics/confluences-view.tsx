"use client";

/**
 * Confluence hit rate tab — /analytics/confluences (MRT wave 1).
 *
 * Win rate and P&L per confluence tag (kind CONFLUENCE), MRT "Confluence
 * hit rate". Sortable table with a win-rate bar per row; clicking a row (or
 * its "View trades" action) opens the trade list filtered on that
 * confluence (/trades?tagId=…). A trade can carry several confluences, so
 * row totals can exceed the tagged total — stated in the note, never hidden.
 * No conclusion is drawn under 10 trades: the sample size is shown on every
 * row and in the note.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
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
import { AdvKpi, fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import {
  MIN_SAMPLE_CONFLUENCE,
  type ConfluenceRow,
} from "@/lib/analytics/advanced";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

type SortKey =
  | "name"
  | "count"
  | "winRate"
  | "netPnl"
  | "avgR"
  | "expectancy";

function sortValue(row: ConfluenceRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "count":
      return row.count;
    case "winRate":
      return row.winRate ?? -1;
    case "netPnl":
      return Number(row.netPnl);
    case "avgR":
      return row.avgR ?? -Infinity;
    case "expectancy":
      return row.expectancy ?? -Infinity;
  }
}

export function ConfluencesView() {
  const t = useTranslations("analytics.advanced.confluences");
  const tRoot = useTranslations("analytics.advanced");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("count");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics({
    period,
    account: accountId === "all" ? undefined : accountId,
  });
  const result = data?.advanced.confluences ?? null;
  const rows = result?.rows ?? [];
  const currency = data?.currency ?? "USD";
  const total = result?.total ?? 0;
  const tagged = result?.tagged ?? 0;
  const coverage =
    total > 0 ? Math.round((tagged / total) * 1000) / 10 : null;
  const best = React.useMemo(
    () =>
      rows
        .filter((r) => r.count >= MIN_SAMPLE_CONFLUENCE)
        .sort(
          (a, b) =>
            (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity)
        )[0] ?? null,
    [rows]
  );

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const openTrades = (row: ConfluenceRow) =>
    navigate(`/trades?tagId=${encodeURIComponent(row.tagId)}`);

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? (
      <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
    );

  const sortHead = (key: SortKey, label: string, alignRight = true) => (
    <TableHead
      className={alignRight ? "text-right" : undefined}
      aria-sort={
        sortKey === key
          ? sortDir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 font-medium hover:text-foreground",
          alignRight && "flex-row-reverse"
        )}
      >
        {label}
        {sortIcon(key)}
      </button>
    </TableHead>
  );

  return (
    <AdvancedShell
      tab="confluences"
      title={t("title")}
      description={t("desc")}
      period={period}
      onPeriodChange={setPeriod}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={total === 0}
      sampleCount={total > 0 ? total : null}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdvKpi label={t("kpiTagged")} value={fmtNum(tagged)} sub={t("kpiTaggedSub", { total })} />
          <AdvKpi
            label={t("kpiCoverage")}
            value={coverage == null ? "-" : `${fmtNum(coverage, 1)} %`}
            sub={t("kpiCoverageSub")}
          />
          <AdvKpi
            label={t("kpiUntagged")}
            value={fmtNum(result?.untagged ?? 0)}
            sub={t("kpiUntaggedSub")}
          />
          <AdvKpi
            label={t("kpiBest")}
            value={best ? best.name : "-"}
            sub={
              best
                ? t("kpiBestSub", { expectancy: fmtR(best.expectancy), count: best.count })
                : t("kpiBestNone")
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("tableTitle")}</CardTitle>
            <CardDescription>{t("tableDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/trades/new")}>
                  {t("emptyAction")}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sortHead("name", t("colConfluence"), false)}
                      {sortHead("count", t("colCount"))}
                      {sortHead("winRate", t("colWinRate"))}
                      {sortHead("netPnl", t("colNetPnl"))}
                      {sortHead("avgR", t("colAvgR"))}
                      {sortHead("expectancy", t("colExpectancy"))}
                      <TableHead>
                        <span className="sr-only">{t("colTrades")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((row) => (
                      <TableRow
                        key={row.tagId}
                        className="cursor-pointer"
                        onClick={() => openTrades(row)}
                      >
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: row.color }}
                              aria-hidden="true"
                            />
                            {row.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count}
                          <span className="text-muted-foreground">
                            {" "}
                            ({t("winsLosses", { wins: row.wins, losses: row.losses })})
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex w-28 flex-col items-end gap-1">
                            <span className="tabular-nums">
                              {fmtPctValue(row.winRate)}
                            </span>
                            <span
                              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                              aria-hidden="true"
                            >
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${row.winRate ?? 0}%` }}
                              />
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Money signed value={row.netPnl} currency={currency} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(row.avgR)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtR(row.expectancy)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTrades(row);
                            }}
                          >
                            {t("viewTrades")}
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              {t("noteMulti")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("noteSample", { min: MIN_SAMPLE_CONFLUENCE })}
            </p>
          </CardContent>
        </Card>
      </div>
    </AdvancedShell>
  );
}
