"use client";

/**
 * Weekly improvement plan tab — /analytics/weekly-plan (MRT wave 1).
 *
 * Rule-based plan for the current Monday-Sunday week, built from the last
 * 30 days of closed trades: discipline score (reused from the trader
 * score), an honest edge check, the number one leak, up to five actions
 * with "Done this week" checkboxes persisted in the database, strengths
 * and fixes in accordions, and the patterns the rules found. No AI, no
 * chat, no invented figures: under five trades the view says so plainly
 * and shows no plan.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, CircleAlert, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AdvancedShell } from "./advanced-shell";
import { Money } from "@/components/privacy/money";
import {
  useToggleWeeklyPlanAction,
  useWeeklyPlan,
} from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import type { PlanAction } from "@/lib/analytics/weekly-plan";
import { navigate } from "@/lib/router";

const GRADE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  excellent: "default",
  good: "secondary",
  developing: "outline",
  fragile: "destructive",
};

const EDGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  yes: "default",
  "not-yet": "secondary",
  no: "destructive",
};

function formatDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * One weekly plan action with its "Done this week" checkbox. Exported so
 * the performance report's "Next week" section reuses the exact same row
 * (same checkbox, same toggle) instead of duplicating it.
 */
export function ActionRow({
  action,
  pending,
  onToggle,
}: {
  action: PlanAction;
  pending: boolean;
  onToggle: (rule: PlanAction["rule"], done: boolean) => void;
}) {
  const t = useTranslations("analytics.advanced.weeklyPlan");
  const id = `weekly-action-${action.rule}`;
  return (
    <li
      className={
        "flex gap-3 rounded-lg border p-4 transition-colors " +
        (action.done ? "border-gain-subtle bg-gain-subtle" : "")
      }
    >
      <Checkbox
        id={id}
        checked={action.done}
        disabled={pending}
        onCheckedChange={(v) => onToggle(action.rule, v === true)}
        aria-label={t("markDone", { title: action.title })}
        className="mt-1 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <label
          htmlFor={id}
          className={
            "block cursor-pointer text-sm font-semibold leading-snug " +
            (action.done ? "text-muted-foreground line-through" : "")
          }
        >
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
            {action.rank}
          </span>
          {action.title}
        </label>
        <p className="text-sm text-muted-foreground">
          {action.evidence.label}:{" "}
          <Money
            value={action.evidence.netPnl}
            currency={action.evidence.currency}
            signed
            maxDigits={0}
          />
          {action.evidence.suffix ?? ""}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium">
            <Target className="h-3.5 w-3.5 text-gain" aria-hidden="true" />
            {t("target")}: {action.target}
          </span>
          {action.evidence.avgR != null ? (
            <span className="tabular-nums text-muted-foreground">
              {t("avgR", { value: action.evidence.avgR })}
            </span>
          ) : null}
          {action.evidence.winRate != null ? (
            <span className="tabular-nums text-muted-foreground">
              {t("winRate", { value: action.evidence.winRate })}
            </span>
          ) : null}
          <span className="tabular-nums text-muted-foreground">
            {t("sampleTrades", { count: action.evidence.trades })}
          </span>
        </p>
      </div>
      {action.done ? (
        <CheckCircle2
          className="h-5 w-5 shrink-0 text-gain"
          aria-hidden="true"
        />
      ) : null}
    </li>
  );
}

export function WeeklyPlanView() {
  const t = useTranslations("analytics.advanced.weeklyPlan");
  const [accountId, setAccountId] = React.useState<string>("all");
  const account = accountId === "all" ? undefined : accountId;
  const { data, isLoading, isError, refetch } = useWeeklyPlan(account);
  const toggle = useToggleWeeklyPlanAction(account);
  const plan = data?.plan ?? null;

  const doneCount = plan?.actions.filter((a) => a.done).length ?? 0;
  const totalCount = plan?.actions.length ?? 0;

  return (
    <AdvancedShell
      tab="weekly-plan"
      title={t("title")}
      description={t("desc")}
      period={"30d" as AnalyticsPeriod}
      onPeriodChange={() => undefined}
      accountId={accountId}
      onAccountChange={setAccountId}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      empty={false}
      sampleCount={plan?.sampleSize ?? null}
      hidePeriod
    >
      {plan == null ? null : !plan.sufficient ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("notEnoughTitle")}</CardTitle>
            <CardDescription>
              {t("notEnoughDetail", {
                count: plan.sampleSize,
                min: 5,
                window: plan.windowDays,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/trades/new")}>
              {t("logTrade")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Week + progress */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">
              {t("weekOf", {
                start: formatDay(plan.weekStart),
                end: formatDay(plan.weekEnd),
              })}
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {t("progress", { done: doneCount, total: totalCount })}
            </p>
          </div>
          <Progress
            value={totalCount === 0 ? 0 : (doneCount / totalCount) * 100}
            aria-label={t("progress", { done: doneCount, total: totalCount })}
          />

          {/* Discipline score + edge check */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("disciplineTitle")}</CardTitle>
                <CardDescription>{t("disciplineDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <p className="text-5xl font-bold tabular-nums">
                    {plan.disciplineScore}
                    <span className="text-2xl text-muted-foreground"> / 100</span>
                  </p>
                  <Badge variant={GRADE_VARIANT[plan.scoreGrade]}>
                    {t(`grade${plan.scoreGrade[0].toUpperCase()}${plan.scoreGrade.slice(1)}`)}
                  </Badge>
                </div>
                <ul className="space-y-2">
                  {(
                    [
                      "discipline",
                      "edge",
                      "consistency",
                      "risk",
                    ] as const
                  ).map((key) => (
                    <li key={key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">
                          {t(`comp${key[0].toUpperCase()}${key.slice(1)}`)}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {plan.scoreComponents[key]} / 25
                        </span>
                      </div>
                      <Progress value={(plan.scoreComponents[key] / 25) * 100} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("edgeTitle")}</CardTitle>
                <CardDescription>{t("edgeDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant={EDGE_VARIANT[plan.edge.verdict]}>
                  {t(`edge${plan.edge.verdict === "yes" ? "Yes" : plan.edge.verdict === "no" ? "No" : "NotYet"}`)}
                </Badge>
                <p className="text-sm text-muted-foreground">{plan.edge.reason}</p>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("expectancy")}</dt>
                    <dd className="font-semibold tabular-nums">
                      {plan.edge.expectancyR != null
                        ? `${plan.edge.expectancyR > 0 ? "+" : ""}${plan.edge.expectancyR.toFixed(2)}R`
                        : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("sample")}</dt>
                    <dd className="font-semibold tabular-nums">{plan.edge.sampleSize}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("sqn")}</dt>
                    <dd className="font-semibold tabular-nums">
                      {plan.edge.sqn != null ? plan.edge.sqn.toFixed(2) : "-"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          {/* Fix this first */}
          {plan.fixFirst != null ? (
            <Card className="border-gain-subtle">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircleAlert className="h-5 w-5 text-gain" aria-hidden="true" />
                  {t("fixFirst")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-base font-semibold">{plan.fixFirst.title}</p>
                <p className="text-sm text-muted-foreground">
                  {plan.fixFirst.evidence.label}:{" "}
                  <Money
                    value={plan.fixFirst.evidence.netPnl}
                    currency={plan.fixFirst.evidence.currency}
                    signed
                    maxDigits={0}
                  />
                  {plan.fixFirst.evidence.suffix ?? ""}
                </p>
                <p className="text-sm">
                  <span className="font-medium">{t("target")}: </span>
                  {plan.fixFirst.target}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("actionsTitle")}</CardTitle>
              <CardDescription>{t("actionsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {plan.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noActions")}</p>
              ) : (
                <ul className="space-y-3">
                  {plan.actions.map((action) => (
                    <ActionRow
                      key={action.rule}
                      action={action}
                      pending={toggle.isPending}
                      onToggle={(rule, done) =>
                        toggle.mutate({ rule, done })
                      }
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Strengths / fixes */}
          <Accordion type="multiple" defaultValue={["strengths"]}>
            <AccordionItem value="strengths">
              <AccordionTrigger>{t("strengthsTitle")}</AccordionTrigger>
              <AccordionContent>
                {plan.strengths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noStrengths")}</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {plan.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="fixes">
              <AccordionTrigger>{t("fixesTitle")}</AccordionTrigger>
              <AccordionContent>
                {plan.fixes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noFixes")}</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {plan.fixes.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Patterns found */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("patternsTitle")}</CardTitle>
              <CardDescription>{t("patternsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {plan.patterns.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noPatterns")}</p>
              ) : (
                <ul className="space-y-3">
                  {plan.patterns.map((p) => (
                    <li key={p.id} className="flex gap-3 text-sm">
                      <span
                        className={
                          "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                          (p.tone === "good"
                            ? "bg-gain"
                            : p.tone === "bad"
                              ? "bg-loss"
                              : "bg-muted-foreground")
                        }
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium">{p.label}</p>
                        <p className="text-muted-foreground">
                          {p.detail} {t("patternSample", { count: p.sampleSize })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{t("methodNote")}</p>
        </div>
      )}
    </AdvancedShell>
  );
}
