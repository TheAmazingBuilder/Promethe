"use client";

/**
 * Cross-analysis tab - /analytics/cross-analysis (§25.7).
 *
 * Review quality, rule compliance (checklist) and strategy version,
 * side by side with the financial result. Every number comes from the
 * user's own closed trades; nothing is invented and no comparison is
 * drawn as a causal claim - see the causation note at the top of the
 * view. A comparison between two groups is only shown when each group
 * has at least MIN_SAMPLE_CROSS trades; below that the numbers stay
 * visible but no difference is stated.
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
import { AdvKpi, fmtPctValue, fmtR } from "./advanced-bits";
import { useAdvancedAnalytics } from "@/hooks/use-trading";
import {
  MIN_SAMPLE_CROSS,
  MIN_TRADES_CROSS,
  type CrossComparison,
  type CrossGradeMix,
  type CrossGroupRow,
  type CrossVersionRow,
} from "@/lib/analytics/advanced";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { fmtNum, fmtSigned } from "@/lib/format";
import { Money } from "@/components/privacy/money";

function fmtGradeMix(mix: CrossGradeMix): string {
  const parts: string[] = [];
  if (mix.plus > 0) parts.push(`A+ ${mix.plus}`);
  if (mix.a > 0) parts.push(`A ${mix.a}`);
  if (mix.b > 0) parts.push(`B ${mix.b}`);
  if (mix.c > 0) parts.push(`C ${mix.c}`);
  if (parts.length === 0) return `${mix.ungraded} ungraded`;
  return `${parts.join(" · ")} · ${mix.ungraded} ungraded`;
}

function fmtWilson(row: CrossGroupRow): string {
  if (row.wilsonLower == null || row.wilsonUpper == null) return "-";
  return `${fmtNum(row.wilsonLower, 1)} - ${fmtNum(row.wilsonUpper, 1)} %`;
}

function fmtSignedR(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${fmtSigned(value.toFixed(2))} R`;
}

function fmtSignedPoints(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return fmtSigned(value.toFixed(1));
}

function GroupRowCells({
  row,
  currency,
}: {
  row: CrossGroupRow;
  currency: string;
}) {
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {row.count}
        <span className="text-muted-foreground">
          {" "}
          ({row.wins}W / {row.losses}L
          {row.breakevens > 0 ? ` / ${row.breakevens} BE` : ""})
        </span>
        <span className="block text-xs text-muted-foreground">
          {row.rSampleSize} R
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex w-28 flex-col items-end gap-1">
          <span className="tabular-nums">{fmtPctValue(row.winRate)}</span>
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
        {fmtWilson(row)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtR(row.avgR)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtR(row.totalR)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Money signed value={row.netPnl} currency={currency} />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {fmtGradeMix(row.gradeMix)}
      </TableCell>
    </>
  );
}

function ComparisonNote({
  comparison,
  text,
  tooSmallText,
}: {
  comparison: CrossComparison;
  text: string;
  tooSmallText: string;
}) {
  if (!comparison.comparable) {
    return <p className="text-sm text-muted-foreground">{tooSmallText}</p>;
  }
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function CrossAnalysisView() {
  const t = useTranslations("analytics.advanced.crossAnalysis");
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("all");
  const [accountId, setAccountId] = React.useState<string>("all");
  const { data, isLoading, isError, refetch } = useAdvancedAnalytics(
    {
      period,
      account: accountId === "all" ? undefined : accountId,
    },
    "cross-analysis"
  );
  const result = data?.advanced.crossAnalysis ?? null;
  const currency = data?.currency ?? "USD";
  const total = result?.total ?? 0;
  const tooFew = total > 0 && total < MIN_TRADES_CROSS;
  const checklist = result?.checklist ?? null;
  const review = result?.review ?? null;
  const versions: CrossVersionRow[] = result?.versions ?? [];
  const checklistCoverage =
    checklist != null && total > 0
      ? Math.round(
          ((checklist.complete.count + checklist.incomplete.count) / total) *
            1000
        ) / 10
      : null;
  const reviewedShare =
    review != null && total > 0
      ? Math.round((review.reviewed.count / total) * 1000) / 10
      : null;

  return (
    <AdvancedShell
      tab="cross-analysis"
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
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t("causationNote")}
            </p>
          </CardContent>
        </Card>

        {tooFew ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                {t("notEnoughTrades", { min: MIN_TRADES_CROSS })}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AdvKpi
                label={t("kpiTotal")}
                value={fmtNum(total)}
                sub={t("kpiTotalSub")}
              />
              <AdvKpi
                label={t("kpiChecklist")}
                value={
                  checklistCoverage == null
                    ? "-"
                    : `${fmtNum(checklistCoverage, 1)} %`
                }
                sub={t("kpiChecklistSub")}
              />
              <AdvKpi
                label={t("kpiReviewed")}
                value={fmtNum(review?.reviewed.count ?? 0)}
                sub={
                  reviewedShare == null
                    ? t("kpiReviewedSub", { total })
                    : `${fmtNum(reviewedShare, 1)} % ${t("kpiReviewedSub", { total })}`
                }
              />
              <AdvKpi
                label={t("kpiCompleteness")}
                value={
                  review?.avgCompleteness == null
                    ? "-"
                    : `${fmtNum(review.avgCompleteness * 100, 0)} %`
                }
                sub={t("kpiCompletenessSub")}
              />
            </div>

            {checklist != null ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("checklistTitle")}
                  </CardTitle>
                  <CardDescription>{t("checklistDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colGroup")}</TableHead>
                          <TableHead className="text-right">
                            {t("colCount")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWinRate")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWilson")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colAvgR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colTotalR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colNetPnl")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colGradeMix")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupComplete")}
                          </TableCell>
                          <GroupRowCells
                            row={checklist.complete}
                            currency={currency}
                          />
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupIncomplete")}
                          </TableCell>
                          <GroupRowCells
                            row={checklist.incomplete}
                            currency={currency}
                          />
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupNoChecklist")}
                          </TableCell>
                          <GroupRowCells
                            row={checklist.noChecklist}
                            currency={currency}
                          />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <ComparisonNote
                    comparison={checklist}
                    text={t("comparisonChecklist", {
                      avgRDiff: fmtSignedR(checklist.avgRDiff),
                      winRateDiff: fmtSignedPoints(checklist.winRateDiff),
                    })}
                    tooSmallText={t("comparisonTooSmall", {
                      min: MIN_SAMPLE_CROSS,
                    })}
                  />
                </CardContent>
              </Card>
            ) : null}

            {review != null ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("reviewTitle")}
                  </CardTitle>
                  <CardDescription>{t("reviewDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colGroup")}</TableHead>
                          <TableHead className="text-right">
                            {t("colCount")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWinRate")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWilson")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colAvgR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colTotalR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colNetPnl")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colGradeMix")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupReviewed")}
                          </TableCell>
                          <GroupRowCells
                            row={review.reviewed}
                            currency={currency}
                          />
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupNotReviewed")}
                          </TableCell>
                          <GroupRowCells
                            row={review.notReviewed}
                            currency={currency}
                          />
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupReviewedFull")}
                          </TableCell>
                          <GroupRowCells
                            row={review.reviewedFull}
                            currency={currency}
                          />
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">
                            {t("groupReviewedPartial")}
                          </TableCell>
                          <GroupRowCells
                            row={review.reviewedPartial}
                            currency={currency}
                          />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <ComparisonNote
                    comparison={review}
                    text={t("comparisonReview", {
                      avgRDiff: fmtSignedR(review.avgRDiff),
                      winRateDiff: fmtSignedPoints(review.winRateDiff),
                    })}
                    tooSmallText={t("comparisonTooSmall", {
                      min: MIN_SAMPLE_CROSS,
                    })}
                  />
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("versionsTitle")}
                </CardTitle>
                <CardDescription>{t("versionsDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("noRows")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colStrategy")}</TableHead>
                          <TableHead>{t("colVersion")}</TableHead>
                          <TableHead className="text-right">
                            {t("colCount")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWinRate")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colWilson")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colAvgR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colTotalR")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colNetPnl")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("colGradeMix")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {versions.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              {row.strategyName ?? t("strategyNone")}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {row.version == null
                                ? t("versionNone")
                                : `v${row.version}`}
                            </TableCell>
                            <GroupRowCells row={row} currency={currency} />
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("noteSample", { min: MIN_SAMPLE_CROSS })}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdvancedShell>
  );
}
