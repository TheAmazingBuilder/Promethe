"use client";

/**
 * Rule violations attached to one trade (v1 phase 6) — read-only section of
 * the trade detail. Hidden when the trade respects every rule.
 * Data: GET /api/trades/[id]/violations.
 */
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/app/session-context";
import { useTradeViolations } from "@/hooks/use-goals";
import { useFormat } from "@/lib/format/use-format";
import {
  formatMeasuredValue,
  formatRuleValue,
} from "@/components/rules/goal-format";

export function TradeViolationsSection({ tradeId }: { tradeId: string }) {
  const t = useTranslations("trades.detail.violations");
  const tRules = useTranslations("goalsView.rules");
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const { data, isLoading } = useTradeViolations(tradeId || null);
  const fmt = useFormat();

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-xl" aria-hidden="true" />;
  }
  const violations = data ?? [];
  if (violations.length === 0) return null;

  return (
    <Card className="border-rose-200 dark:border-rose-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-rose-500" aria-hidden="true" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {violations.map((v, i) => (
            <li
              key={`${v.ruleId}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200/60 bg-rose-500/5 p-2.5 text-sm dark:border-rose-900/60"
            >
              <span className="font-medium">
                {tRules(`kind.${v.kind}`)}
                {v.description ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    - {v.description}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {t("measured")}{" "}
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  {formatMeasuredValue(fmt, v.kind, v.measured, currency)}
                </span>
                {" / "}
                {t("limit")} {formatRuleValue(fmt, v.kind, v.limit, currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
