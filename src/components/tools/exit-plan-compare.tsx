/**
 * v2.5 Module 5 (f) - plan-vs-real comparison on the trade detail page.
 *
 * The user picks an ExitPlan for the trade (Trade.exitPlanId, written
 * through the trade API). Planned tiers are
 * compared with the actual partial exits (TradeExecution PARTIAL_EXIT /
 * FINAL_EXIT) and SL moves (TradeModification); when a trade has no
 * executions yet, the realized % per tier can be typed manually.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { comparePlanVsReal, tierRMultiple } from "@/lib/tools/exit-plans";
import { isToolsTablesMissing, useExitPlans } from "@/hooks/use-tools";
import { useUpdateTrade } from "@/hooks/use-trading";
import type { TradeDetailDTO } from "@/lib/trading/dto";
import { ToolsUnavailable } from "./shared";
import { fmtNum } from "@/lib/format";

export function ExitPlanCompare({ trade }: { trade: TradeDetailDTO }) {
  const t = useTranslations("tools");
  const plansQuery = useExitPlans();
  const plans = plansQuery.data ?? [];
  const updateTrade = useUpdateTrade();
  const [manual, setManual] = React.useState<Record<number, string>>({});

  const planId = trade.exitPlanId ?? "";
  React.useEffect(() => {
    setManual({});
  }, [trade.id, planId]);
  const manualInvalid = Object.values(manual).some((value) => {
    const trimmed = value.trim();
    return trimmed !== "" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) ||
      (trimmed !== "" && Number(trimmed) > 100);
  });
  const plan = plans.find((p) => p.id === planId) ?? null;

  const comparison = React.useMemo(() => {
    if (!plan) return null;
    return comparePlanVsReal(
      plan,
      trade.direction === "SHORT" ? "SHORT" : "LONG",
      trade.entryPrice,
      trade.stopLoss,
      trade.lots,
      trade.executions.map((e) => ({
        id: e.id,
        type: e.type,
        price: e.price,
        lots: e.lots,
        time: e.time,
      })),
      trade.modifications.map((m) => ({
        id: m.id,
        time: m.time,
        field: m.field,
        oldValue: m.oldValue,
        newValue: m.newValue,
      })),
      manual
    );
  }, [plan, trade, manual]);

  return (
    <div className="space-y-3">
      {isToolsTablesMissing(plansQuery.error) && <ToolsUnavailable />}
      <div className="space-y-2">
        <Label htmlFor={`epc-plan-${trade.id}`}>{t("exitPlanCompareSelect")}</Label>
        <Select
          value={planId === "" ? "none" : planId}
          onValueChange={(v) =>
            updateTrade.mutate({
              id: trade.id,
              patch: { exitPlanId: v === "none" ? null : v },
            })
          }
        >
          <SelectTrigger id={`epc-plan-${trade.id}`} className="w-full">
            <SelectValue placeholder={t("exitPlanComparePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("exitPlanCompareNone")}</SelectItem>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {plans.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("exitPlanCompareEmpty")}</p>
        )}
      </div>

      {plan && comparison && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("exitPlanColTier")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("exitPlanColPlanned")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("exitPlanColTarget")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("exitPlanColRealized")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("exitPlanColStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.tiers.map((row) => {
                  const r =
                    row.tier.targetType === "PRICE"
                      ? tierRMultiple(row.tier.target, trade.direction === "SHORT" ? "SHORT" : "LONG", trade.entryPrice, trade.stopLoss)
                      : null;
                  return (
                    <tr key={row.index} className="border-b last:border-0">
                      <td className="px-3 py-2">TP{row.index + 1}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.tier.pct, 0)} %</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.tier.targetType === "R"
                          ? `${row.tier.target}R`
                          : `${row.tier.target}${r ? ` (${fmtNum(r, 2)}R)` : ""}`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          aria-label={t("exitPlanRealizedAria", { n: row.index + 1 })}
                          type="number" inputMode="decimal" min="0" max="100" step="any"
                          className="ml-auto w-20 text-right tabular-nums"
                          placeholder={fmtNum(row.realizedPct, 0)}
                          value={manual[row.index] ?? ""}
                          aria-invalid={
                            (manual[row.index] ?? "").trim() !== "" &&
                            (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test((manual[row.index] ?? "").trim()) ||
                              Number(manual[row.index]) > 100)
                          }
                          onChange={(e) =>
                            setManual((prev) => ({ ...prev, [row.index]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Badge
                          variant={row.status === "done" ? "default" : row.status === "partial" ? "secondary" : "outline"}
                          className={row.status === "done" ? "bg-emerald-600 hover:bg-emerald-600" : undefined}
                        >
                          {t(`exitPlanStatus_${row.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {manualInvalid ? (
            <p className="text-xs text-red-600 dark:text-red-400">{t("exitPlanManualPctInvalid")}</p>
          ) : null}
          {comparison.totalRealizedPct.gt(100) ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("exitPlanRealizedOver100")}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t("exitPlanTotalRealized", {
              realized: fmtNum(comparison.totalRealizedPct, 0),
              planned: fmtNum(comparison.plannedTotalPct, 0),
            })}
            {comparison.breakevenMoved ? ` - ${t("exitPlanBreakevenDone")}` : ""}
            {comparison.trailingStarted ? ` - ${t("exitPlanTrailingDone")}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
