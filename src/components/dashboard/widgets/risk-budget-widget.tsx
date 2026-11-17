"use client";

/**
 * Daily risk-budget gauge widget (Phase 2) — emerald dashboard widget.
 *
 * Budget = user-defined % of the balance (set in #/outils → Risk /
 * Reward). Consumed today = Σ risk of OPEN trades + realized losses of
 * the trading day. This is NOT the prop daily-loss limit: that one
 * counts realized losses only, while the budget also counts the risk
 * sitting in open positions — the widget says so.
 *
 * No budget set → the widget invites the user to set one instead of
 * showing a made-up number. Self-fetching (hasLoader: false).
 */
import { useTranslations } from "next-intl";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/privacy/money";
import { useRiskRewardSummary } from "@/hooks/use-risk-reward";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { fmtNum } from "@/lib/format";

export function RiskBudgetWidget() {
  const t = useTranslations("tools");
  const tRisk = useTranslations("riskReward");
  const fmt = useFormat();
  const { data, isLoading, isError } = useRiskRewardSummary();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) return null;

  const currency = data.currency;
  const usedPct =
    data.today.usedPercent != null
      ? Math.min(100, data.today.usedPercent * 100)
      : null;
  const over = data.today.usedPercent != null && data.today.usedPercent >= 1;

  return (
    <Card className={over ? "border-loss-subtle" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {tRisk("budgetWidgetTitle")}
        </CardTitle>
        <CardDescription>
          {tRisk("budgetWidgetDesc", { day: data.tradingDay })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data.budget.isSet ? (
          <>
            <p className="text-sm text-muted-foreground">
              {tRisk("budgetWidgetNotSet")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/outils/risk-reward")}
            >
              {tRisk("budgetWidgetSetUp")}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-2xl font-semibold tabular-nums">
                <Money value={data.today.consumed} currency={currency} />
                <span className="text-sm font-normal text-muted-foreground">
                  {" / "}
                  <Money
                    value={data.budget.amount ?? "0"}
                    currency={currency}
                  />
                </span>
              </p>
              {usedPct != null ? (
                <p className="text-sm tabular-nums text-muted-foreground">
                  {fmtNum(usedPct, 0)}%
                </p>
              ) : null}
            </div>
            {usedPct != null ? (
              <Progress
                value={usedPct}
                aria-label={t("rrBudgetUsed", { pct: fmtNum(usedPct, 0) })}
              />
            ) : null}
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="flex justify-between gap-2">
                <span>{t("rrBudgetOpenRisk")}</span>
                <span className="tabular-nums">
                  {fmt.money(data.today.openRisk, currency)}
                  {` (${data.today.openTrades} ${tRisk("budgetWidgetOpenTrades")})`}
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span>{t("rrBudgetRealizedLoss")}</span>
                <span className="tabular-nums">
                  {fmt.money(data.today.realizedLossToday, currency)}
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span>{t("rrBudgetRemaining")}</span>
                <span
                  className={`tabular-nums ${over ? "font-medium text-loss" : ""}`}
                >
                  {data.today.remaining != null
                    ? fmt.money(data.today.remaining, currency)
                    : "—"}
                </span>
              </p>
            </div>
            {over ? (
              <p className="rounded-lg border border-loss-subtle bg-loss-subtle p-2 text-xs">
                {t("rrBudgetOver")}
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              {tRisk("budgetWidgetNote")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
