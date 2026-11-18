"use client";

/**
 * Goals tab — /analytics/goals (MRT wave 3).
 *
 * The MRT-style goals home: predefined goal templates (in code, never
 * seeded) the user adds in one click, then their own goals with live
 * progress bars computed automatically from closed trades. Nothing is
 * typed by hand for progress: the engine recomputes every value from
 * the trades on each read. A goal with no eligible sample yet shows an
 * honest empty state (never a misleading 0%), and each card links to
 * the trades behind it. No sidebar entry: the tab lives inside
 * Analytics, next to the weekly plan, and in the command palette.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCreateGoal, useGoals } from "@/hooks/use-goals";
import { useSession } from "@/components/app/session-context";
import { useFormat } from "@/lib/format/use-format";
import { AdvancedShell } from "./advanced-shell";
import { GoalCard } from "@/components/rules/goal-card";
import { formatGoalValue } from "@/components/rules/goal-format";
import { GOAL_TEMPLATES, type GoalTemplate } from "@/lib/trading/goal-templates";
import type { GoalInput } from "@/lib/validations/goals";

/** Local calendar day YYYY-MM-DD (client-side default, effect-only). */
function todayLocalDay(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TemplateCard({
  template,
  alreadyActive,
  onAdd,
  pending,
}: {
  template: GoalTemplate;
  alreadyActive: boolean;
  onAdd: (template: GoalTemplate) => void;
  pending: boolean;
}) {
  const t = useTranslations("analytics.advanced.goals");
  const tGoals = useTranslations("goalsView");
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const fmt = useFormat();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">
            {t(`templates.${template.id}.name`)}
          </span>
        </CardTitle>
        <CardDescription>
          {t(`templates.${template.id}.desc`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm tabular-nums">
          <span className="font-semibold">
            {formatGoalValue(fmt, template.metric, template.targetValue, currency)}
          </span>{" "}
          <span className="text-muted-foreground">
            · {tGoals(`period.${template.period}`)}
          </span>
        </p>
        {alreadyActive ? (
          <Badge variant="secondary">{t("alreadyTracking")}</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onAdd(template)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("addGoal")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function GoalsView() {
  const t = useTranslations("analytics.advanced.goals");
  const tGoals = useTranslations("goalsView");
  const { toast } = useToast();
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const { data, isLoading, isError, refetch } = useGoals();
  const create = useCreateGoal();

  const goalList = data?.goals ?? [];
  const activeGoals = goalList.filter((g) => g.status === "ACTIVE");
  const pausedGoals = goalList.filter((g) => g.status === "PAUSED");
  const activeMetrics = new Set(activeGoals.map((g) => g.metric));

  const onAddTemplate = async (template: GoalTemplate) => {
    const input: GoalInput = {
      name: t(`templates.${template.id}.name`),
      description: t(`templates.${template.id}.desc`),
      metric: template.metric,
      targetValue: template.targetValue,
      period: template.period,
      startDate: todayLocalDay(),
      endDate: null,
      status: "ACTIVE",
    };
    try {
      await create.mutateAsync(input);
      toast({ title: t("addedToast") });
    } catch {
      toast({ title: tGoals("errorToast"), variant: "destructive" });
    }
  };

  return (
    <AdvancedShell
      tab="goals"
      title={t("title")}
      description={t("desc")}
      period={"30d"}
      onPeriodChange={() => undefined}
      accountId="all"
      onAccountChange={() => undefined}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={false}
      sampleCount={null}
      hidePeriod
      hideAccount
    >
      <div className="space-y-6">
        {/* Suggested goals (templates, in code only) */}
        <section aria-labelledby="goals-templates-heading">
          <h2
            id="goals-templates-heading"
            className="mb-3 text-sm font-semibold"
          >
            {t("templatesTitle")}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {t("templatesDesc")}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {GOAL_TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                alreadyActive={activeMetrics.has(template.metric)}
                onAdd={(tpl) => void onAddTemplate(tpl)}
                pending={create.isPending}
              />
            ))}
          </div>
        </section>

        {/* The user's goals, with live progress */}
        <section aria-labelledby="goals-yours-heading">
          <h2 id="goals-yours-heading" className="mb-3 text-sm font-semibold">
            {t("yourGoals")}
          </h2>
          {goalList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Target
                  className="h-8 w-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {t("emptyGoals")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {activeGoals.map((g) => (
                  <GoalCard key={g.id} goal={g} currency={currency} />
                ))}
              </div>
              {pausedGoals.length > 0 && (
                <>
                  <h3 className="mt-4 text-sm font-semibold text-muted-foreground">
                    {tGoals("pausedGoals")}
                  </h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {pausedGoals.map((g) => (
                      <GoalCard key={g.id} goal={g} currency={currency} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <p className="text-xs text-muted-foreground">{t("methodNote")}</p>
      </div>
    </AdvancedShell>
  );
}
