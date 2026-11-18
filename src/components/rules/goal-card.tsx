"use client";

/**
 * One goal with its live progress bar, shared by the Rules & goals view
 * and the Analytics Goals tab (MRT wave 3). Progress is always computed
 * from the trades (never typed by hand); the card shows the eligible
 * sample size, an honest empty state when there is nothing to measure
 * yet, and a link to the trades behind the goal when the sample is
 * non-empty.
 */
import * as React from "react";
import {
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useDeleteGoal, useUpdateGoal } from "@/hooks/use-goals";
import { fmtDateInTz } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { goalDrilldownHref } from "@/lib/trading/goals";
import {
  formatGoalValue,
  goalBarTone,
} from "@/components/rules/goal-format";
import type { GoalWithProgressDTO } from "@/lib/trading/dto";

export function GoalCard({
  goal,
  currency,
  onEdit,
}: {
  goal: GoalWithProgressDTO;
  currency: string;
  /** When omitted the edit button is hidden (Analytics Goals tab: the
   * editor lives in the Rules & goals view). */
  onEdit?: () => void;
}) {
  const t = useTranslations("goalsView");
  const { toast } = useToast();
  const fmt = useFormat();
  const update = useUpdateGoal();
  const del = useDeleteGoal();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const paused = goal.status === "PAUSED";
  const { progress } = goal;
  // Honest sample line: never a 0% that pretends to be a measurement.
  // The A+ goal has its own message while no trade is graded yet.
  const noDataText =
    progress.currentValue == null
      ? goal.metric === "A_PLUS_WIN_RATE"
        ? t("noGradedTrades")
        : t("noData")
      : null;
  const sampleText =
    progress.currentValue == null
      ? null
      : goal.metric === "DISCIPLINE_SCORE"
        ? t("sampleDays", { count: progress.sampleSize })
        : t("sampleTrades", { count: progress.sampleSize });
  const drilldownHref = goalDrilldownHref(progress);

  const onToggle = async () => {
    try {
      await update.mutateAsync({
        id: goal.id,
        patch: { status: paused ? "ACTIVE" : "PAUSED" },
      });
      toast({ title: paused ? t("resumedToast") : t("pausedToast") });
    } catch {
      toast({ title: t("errorToast"), variant: "destructive" });
    }
  };

  const onDelete = async () => {
    try {
      await del.mutateAsync(goal.id);
      toast({ title: t("deletedToast") });
      setConfirmOpen(false);
    } catch {
      toast({ title: t("errorToast"), variant: "destructive" });
    }
  };

  return (
    <Card className={paused ? "opacity-60" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {progress.isAchieved ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
          ) : (
            <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <span className="truncate">{goal.name}</span>
          {paused && <Badge variant="secondary">{t("status.PAUSED")}</Badge>}
          {progress.isExpired && !progress.isAchieved && (
            <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400">
              {t("status.EXPIRED")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t(`metric.${goal.metric}`)} · {t(`period.${goal.period}`)}
          {goal.endDate ? ` · ${t("until")} ${fmtDateInTz(goal.endDate, "UTC")}` : ""}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label={t("pauseResume")} onClick={() => void onToggle()}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            {onEdit ? (
              <Button variant="ghost" size="icon" aria-label={t("edit")} onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("delete")}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold tabular-nums">
            {formatGoalValue(fmt, goal.metric, progress.currentValue, currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("targetLabel")} {formatGoalValue(fmt, goal.metric, progress.targetValue, currency)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${goalBarTone(
                progress.progressPercent,
                progress.isAchieved
              )}`}
              style={{ width: `${Math.max(2, progress.progressPercent)}%` }}
              role="progressbar"
              aria-valuenow={progress.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={goal.name}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
            {Math.round(progress.progressPercent)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("window", {
            from: fmtDateInTz(progress.windowStartDay, "UTC"),
            to: fmtDateInTz(
              progress.windowEndDay === "9999-12-31"
                ? new Date().toISOString()
                : progress.windowEndDay,
              "UTC"
            ),
          })}
        </p>
        {noDataText != null ? (
          <p className="text-xs text-muted-foreground">{noDataText}</p>
        ) : (
          <p className="text-xs tabular-nums text-muted-foreground">
            {sampleText}
          </p>
        )}
        {drilldownHref != null ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto w-fit p-0 text-xs"
            onClick={() => navigate(drilldownHref)}
          >
            {t("viewTrades")}
          </Button>
        ) : null}
        {goal.description ? (
          <p className="text-sm text-muted-foreground">{goal.description}</p>
        ) : null}

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
              <DialogDescription>{t("confirmDeleteDesc")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={() => void onDelete()}>
                {t("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

