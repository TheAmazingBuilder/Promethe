"use client";

/**
 * PROP breach-risk widget (v1 phase 5) — daily loss / total drawdown limits
 * with progress bars, profit target progress and current equity. Hidden when
 * the user has no PROP account. Data: GET /api/prop-status.
 */
import { AlertTriangle, CheckCircle2, ShieldAlert, Target } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Money, Sensitive } from "@/components/privacy/money";
import { usePropStatus } from "@/hooks/use-journal";
import { pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { toD } from "@/lib/trading/dec";
import type { PropLimit } from "@/lib/analytics/calendar";

function toneOf(status: PropLimit["status"]): string {
  switch (status) {
    case "BREACHED":
      return "text-loss";
    case "WARNING":
      // a11y (M8 Phase 5): amber-700 on white passes AA (5.0:1); amber-600 was 3.2:1.
      return "text-amber-700 dark:text-amber-400";
    default:
      return "text-gain";
  }
}

function barToneOf(status: PropLimit["status"]): string {
  switch (status) {
    case "BREACHED":
      return "bg-loss";
    case "WARNING":
      return "bg-amber-500";
    default:
      return "bg-gain";
  }
}

/** One limit row: label, used/limit, progress bar, remaining amount. */
function LimitBar({
  label,
  hint,
  limit,
  currency,
  t,
}: {
  label: string;
  hint?: string;
  limit: PropLimit;
  currency: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const fmt = useFormat();
  if (limit.limitAmount == null) return null;
  const pct = Math.min(100, Number(limit.usedPercent ?? 0));
  const remaining = toD(limit.remaining ?? 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {label}
          {hint ? <span className="ml-1 font-normal">({hint})</span> : null}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("limitUsed", {
            used: fmt.money(limit.used, currency),
            limit: fmt.money(limit.limitAmount, currency),
          })}
        </p>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${barToneOf(limit.status)}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
      <p className={`text-[11px] tabular-nums ${toneOf(limit.status)}`}>
        {remaining.lt(0)
          ? t("overLimit", { amount: fmt.money(remaining.neg(), currency) })
          : t("remaining", { amount: fmt.money(remaining, currency) })}
      </p>
    </div>
  );
}

export function PropStatusCard() {
  const t = useTranslations("propStatus");
  const fmt = useFormat();
  const { data, isLoading } = usePropStatus();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  // No PROP account → the widget stays out of the dashboard entirely.
  if (!data?.account || !data.status) return null;

  const { account, status } = data;
  const currency = account.currency;

  return (
    <Card
      data-overall={status.overall}
      className={
        status.overall === "BREACHED"
          ? "border-loss-subtle"
          : status.overall === "WARNING"
            ? "border-amber-500/50"
            : undefined
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {status.overall === "BREACHED" ? (
            <ShieldAlert className="h-4 w-4 text-loss" aria-hidden="true" />
          ) : status.overall === "WARNING" ? (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-gain" aria-hidden="true" />
          )}
          {t("title")} — <Sensitive kind="account">{account.name}</Sensitive>
          <Badge
            variant="secondary"
            className={`ml-auto ${toneOf(status.overall)}`}
          >
            {status.overall === "BREACHED"
              ? t("statusBreached")
              : status.overall === "WARNING"
                ? t("statusWarning")
                : t("statusOk")}
          </Badge>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
          <span>
            {t("equity")}{" "}
            <strong>
              <Money kind="balance" value={status.currentEquity} currency={currency} />
            </strong>
          </span>
          <span className="text-muted-foreground">
            {t("initialBalance")}{" "}
            <Money kind="balance" value={status.initialBalance} currency={currency} />
          </span>
          {status.drawdownType === "TRAILING" ? (
            <span className="text-muted-foreground">
              {t("peak")}{" "}
              <Money kind="balance" value={status.peakEquity} currency={currency} />
            </span>
          ) : null}
          <span className={pnlClass(status.todayPnl)}>
            {t("todayPnl")}{" "}
            <Money signed value={status.todayPnl} currency={currency} />
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <LimitBar
          label={t("dailyLoss")}
          limit={status.dailyLoss}
          currency={currency}
          t={t}
        />
        <LimitBar
          label={t("totalDrawdown")}
          hint={
            status.drawdownType === "TRAILING"
              ? t("drawdownTrailing")
              : t("drawdownStatic")
          }
          limit={status.totalDrawdown}
          currency={currency}
          t={t}
        />
        {/* Profit target */}
        {status.profitTarget.targetAmount != null ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Target className="h-3 w-3" aria-hidden="true" />
                {t("profitTarget")}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t("targetProgress", {
                  gained: fmt.money(status.profitTarget.gained, currency),
                  target: fmt.money(status.profitTarget.targetAmount, currency),
                })}
              </p>
            </div>
            <Progress
              value={Math.min(100, Number(status.profitTarget.progressPercent ?? 0))}
              aria-label={t("profitTarget")}
            />
            <p
              className={`text-[11px] tabular-nums ${
                status.profitTarget.reached
                  ? "text-gain"
                  : "text-muted-foreground"
              }`}
            >
              {status.profitTarget.reached
                ? t("targetReached")
                : t("targetRemaining", {
                    amount: fmt.money(status.profitTarget.remaining ?? 0, currency),
                  })}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
