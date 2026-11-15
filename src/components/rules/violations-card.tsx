"use client";

/**
 * Dashboard violations widget (v1 phase 6) — recent rule violations with the
 * breached limit. Hidden when nothing was violated in the last 30 days.
 * Data: GET /api/rules/violations?days=30.
 */
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/app/session-context";
import { useViolations } from "@/hooks/use-goals";
import { navigate } from "@/lib/router";
import { fmtDateInTz, pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { Money } from "@/components/privacy/money";
import { formatMeasuredValue, formatRuleValue } from "@/components/rules/goal-format";

export function ViolationsCard() {
  const t = useTranslations("dashboard.violationsCard");
  const tRules = useTranslations("goalsView.rules");
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const timezone = session?.profile.timezone ?? "UTC";
  const { data, isLoading } = useViolations(30);
  const fmt = useFormat();

  if (isLoading) {
    return <Skeleton className="h-28 w-full rounded-xl" aria-hidden="true" />;
  }
  const violations = data ?? [];
  if (violations.length === 0) return null;

  return (
    <Card className="border-loss-subtle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-loss" aria-hidden="true" />
          {t("title")}
        </CardTitle>
        <CardDescription className="tabular-nums">
          {t("count", { count: violations.length })}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("#/regles")}
          >
            {t("manage")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {violations.slice(0, 5).map((v, i) => (
            <li
              key={`${v.tradeId}-${v.ruleId}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <button
                type="button"
                className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline"
                onClick={() => navigate(`#/trades/${v.tradeId}`)}
              >
                {tRules(`kind.${v.kind}`)}
                {v.trade ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    · {v.trade.symbol} · {fmtDateInTz(v.trade.entryTime, timezone)}
                  </span>
                ) : null}
              </button>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                <span className={pnlClass(v.measured)}>
                  {formatMeasuredValue(fmt, v.kind, v.measured, currency)}
                </span>
                {" / "}
                {formatRuleValue(fmt, v.kind, v.limit, currency)}
                {v.trade?.netPnl != null ? (
                  <>
                    {" · "}
                    <Money signed value={v.trade.netPnl} currency={currency} />
                  </>
                ) : (
                  ""
                )}
              </span>
            </li>
          ))}
        </ul>
        {violations.length > 5 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("more", { count: violations.length - 5 })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
