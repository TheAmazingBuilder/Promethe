"use client";

/**
 * Rules & goals view (v1 phase 6) — three tabs: measurable goals with live
 * progress, trading rules CRUD (auto re-evaluation on edit), recent
 * violations. Data: /api/goals · /api/rules · /api/rules/violations.
 */
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import {
  useCreateGoal,
  useCreateRule,
  useDeleteGoal,
  useDeleteRule,
  useGoals,
  useRules,
  useUpdateGoal,
  useUpdateRule,
  useViolations,
} from "@/hooks/use-goals";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { fmtDateInTz, pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { Money } from "@/components/privacy/money";
import { navigate } from "@/lib/router";
import {
  formatGoalValue,
  formatMeasuredValue,
  formatRuleValue,
  goalBarTone,
  METRICS,
  PERIODS,
  RULE_KIND_LIST,
} from "@/components/rules/goal-format";
import type { GoalDTO, GoalWithProgressDTO, RuleDTO } from "@/lib/trading/dto";
import type { GoalInput, RuleInput } from "@/lib/validations/goals";

// ── Goal editor dialog ──────────────────────────────────────────────────────

type GoalForm = {
  name: string;
  description: string;
  metric: (typeof METRICS)[number];
  targetValue: string;
  period: (typeof PERIODS)[number];
  startDate: string;
  endDate: string;
  status: "ACTIVE" | "PAUSED";
};

const EMPTY_GOAL: GoalForm = {
  name: "",
  description: "",
  metric: "NET_PNL",
  targetValue: "",
  period: "MONTHLY",
  startDate: "",
  endDate: "",
  status: "ACTIVE",
};

/** Local calendar day YYYY-MM-DD (client-side default, effect-only). */
function todayLocalDay(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function GoalEditor({
  open,
  onOpenChange,
  editing,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: GoalDTO | null;
  currency: string;
}) {
  const t = useTranslations("goalsView.form");
  const tGoals = useTranslations("goalsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const [form, setForm] = React.useState<GoalForm>(EMPTY_GOAL);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name,
            description: editing.description ?? "",
            metric: (METRICS as string[]).includes(editing.metric)
              ? (editing.metric as GoalForm["metric"])
              : "NET_PNL",
            targetValue: editing.targetValue,
            period: (PERIODS as readonly string[]).includes(editing.period)
              ? (editing.period as GoalForm["period"])
              : "MONTHLY",
            startDate: editing.startDate,
            endDate: editing.endDate ?? "",
            status: editing.status === "PAUSED" ? "PAUSED" : "ACTIVE",
          }
        : {
            ...EMPTY_GOAL,
            startDate: todayLocalDay(),
          },
    );
  }, [open, editing]);

  const set = <K extends keyof GoalForm>(key: K, value: GoalForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.name.trim() || !form.targetValue.trim()) return;
    setSaving(true);
    try {
      const payload: GoalInput = {
        name: form.name.trim(),
        description: form.description.trim() === "" ? null : form.description.trim(),
        metric: form.metric,
        targetValue: form.targetValue.trim(),
        period: form.period,
        startDate: form.startDate,
        endDate: form.endDate.trim() === "" ? null : form.endDate.trim(),
        status: form.status,
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload });
        toast({ title: t("updated") });
      } else {
        await create.mutateAsync(payload);
        toast({ title: t("created") });
      }
      onOpenChange(false);
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const targetHint =
    form.metric === "WIN_RATE" || form.metric === "DISCIPLINE_SCORE" ? t("targetHintPct") : t("targetHintAmount");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-name">
              {t("name")}
            </label>
            <Input
              id="goal-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-desc">
              {t("description")}
            </label>
            <Input
              id="goal-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={2000}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-metric">
                {t("metric")}
              </label>
              <Select
                value={form.metric}
                onValueChange={(v) => set("metric", v as GoalForm["metric"])}
              >
                <SelectTrigger id="goal-metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tGoals(`metric.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-target">
                {t("target")}
              </label>
              <Input
                id="goal-target"
                inputMode="decimal"
                value={form.targetValue}
                onChange={(e) => set("targetValue", e.target.value)}
                placeholder={
                  form.metric === "WIN_RATE"
                    ? "55"
                    : form.metric === "NET_PNL"
                      ? `1000 ${currency}`
                      : "1"
                }
              />
              <p className="text-[11px] text-muted-foreground">{targetHint}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-period">
                {t("period")}
              </label>
              <Select
                value={form.period}
                onValueChange={(v) => set("period", v as GoalForm["period"])}
              >
                <SelectTrigger id="goal-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tGoals(`period.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-start">
                {t("startDate")}
              </label>
              <DateField
                id="goal-start"
                value={form.startDate}
                onChange={(v) => set("startDate", v)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="goal-end">
                {t("endDate")}
              </label>
              <DateField
                id="goal-end"
                value={form.endDate}
                onChange={(v) => set("endDate", v)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={saving || !form.name.trim() || !form.targetValue.trim()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Goal card ───────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  currency,
  onEdit,
}: {
  goal: GoalWithProgressDTO;
  currency: string;
  onEdit: () => void;
}) {
  const t = useTranslations("goalsView");
  const { toast } = useToast();
  const fmt = useFormat();
  const update = useUpdateGoal();
  const del = useDeleteGoal();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const paused = goal.status === "PAUSED";
  const { progress } = goal;

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
            <Button variant="ghost" size="icon" aria-label={t("edit")} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
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

// ── Rule editor dialog ──────────────────────────────────────────────────────

type RuleForm = {
  kind: (typeof RULE_KIND_LIST)[number];
  value: string;
  description: string;
  isActive: boolean;
};

const EMPTY_RULE: RuleForm = {
  kind: "MAX_TRADES_PER_DAY",
  value: "",
  description: "",
  isActive: true,
};

function RuleEditor({
  open,
  onOpenChange,
  editing,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RuleDTO | null;
  currency: string;
}) {
  const t = useTranslations("goalsView.rules.form");
  const tRules = useTranslations("goalsView.rules");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateRule();
  const update = useUpdateRule();
  const [form, setForm] = React.useState<RuleForm>(EMPTY_RULE);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            kind: (RULE_KIND_LIST as readonly string[]).includes(editing.kind)
              ? (editing.kind as RuleForm["kind"])
              : "MAX_TRADES_PER_DAY",
            value: editing.value,
            description: editing.description ?? "",
            isActive: editing.isActive,
          }
        : EMPTY_RULE,
    );
  }, [open, editing]);

  const isCount = form.kind === "MAX_TRADES_PER_DAY";
  const isCustom = form.kind === "CUSTOM";

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (isCustom ? !form.description.trim() : !form.value.trim()) return;
    setSaving(true);
    try {
      const payload: RuleInput = {
        kind: form.kind,
        value: isCustom ? "1" : form.value.trim(),
        description: form.description.trim() === "" ? null : form.description.trim(),
        isActive: form.isActive,
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload });
        toast({ title: t("updated") });
      } else {
        await create.mutateAsync(payload);
        toast({ title: t("created") });
      }
      onOpenChange(false);
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-kind">
              {t("kind")}
            </label>
            <Select
              value={form.kind}
              onValueChange={(v) => set("kind", v as RuleForm["kind"])}
            >
              <SelectTrigger id="rule-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_KIND_LIST.map((k) => (
                  <SelectItem key={k} value={k}>
                    {tRules(`kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t(`hint.${form.kind}`)}</p>
          </div>
          {!isCustom && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-value">
                {isCount
                  ? t("valueCount")
                  : form.kind === "MIN_PLANNED_RR"
                    ? t("valueRatio")
                    : t("valueAmount", { currency })}
              </label>
              <Input
                id="rule-value"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                placeholder={isCount ? "3" : form.kind === "MIN_PLANNED_RR" ? "1.5" : "500"}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-desc">
              {t("description")}
            </label>
            <Input
              id="rule-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={500}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="rule-active"
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v === true)}
            />
            {t("active")}
          </label>
          <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
            {t("reEvalNote")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={
              saving || (isCustom ? !form.description.trim() : !form.value.trim())
            }
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────

export function RulesView() {
  const t = useTranslations("goalsView");
  const { toast } = useToast();
  const { session } = useSession();
  const fmt = useFormat();
  const goals = useGoals();
  const rules = useRules();
  const violations = useViolations(30);
  const delRule = useDeleteRule();

  const displayCurrency = session?.profile.baseCurrency ?? "USD";
  const timezone = session?.profile.timezone ?? "UTC";

  const [goalEditorOpen, setGoalEditorOpen] = React.useState(false);
  const [editingGoal, setEditingGoal] = React.useState<GoalDTO | null>(null);
  const [ruleEditorOpen, setRuleEditorOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<RuleDTO | null>(null);

  const goalList = goals.data?.goals ?? [];
  const activeGoals = goalList.filter((g) => g.status === "ACTIVE");
  const pausedGoals = goalList.filter((g) => g.status === "PAUSED");
  const ruleList = rules.data ?? [];
  const violationList = violations.data ?? [];

  const openGoalEditor = (goal: GoalDTO | null) => {
    setEditingGoal(goal);
    setGoalEditorOpen(true);
  };

  const openRuleEditor = (rule: RuleDTO | null) => {
    setEditingRule(rule);
    setRuleEditorOpen(true);
  };

  const onDeleteRule = async (rule: RuleDTO) => {
    try {
      await delRule.mutateAsync(rule.id);
      toast({ title: t("rules.deletedToast") });
    } catch {
      toast({ title: t("errorToast"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => openRuleEditor(null)}>
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("rules.add")}</span>
          </Button>
          <Button onClick={() => openGoalEditor(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("addGoal")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="goals" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="goals">
            {t("tabGoals")}
            <Badge variant="secondary" className="ml-1.5 tabular-nums">
              {activeGoals.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="rules">
            {t("tabRules")}
            <Badge variant="secondary" className="ml-1.5 tabular-nums">
              {ruleList.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="violations">
            {t("tabViolations")}
            {violationList.length > 0 && (
              <Badge className="ml-1.5 bg-rose-500/15 text-rose-700 tabular-nums dark:text-rose-400">
                {violationList.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Goals tab ── */}
        <TabsContent value="goals" className="space-y-4">
          {goals.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-xl" />
              ))}
            </div>
          ) : goalList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Target className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("emptyGoals")}</p>
                <Button size="sm" onClick={() => openGoalEditor(null)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("addGoal")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {activeGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    currency={displayCurrency}
                    onEdit={() => openGoalEditor(g)}
                  />
                ))}
              </div>
              {pausedGoals.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {t("pausedGoals")}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {pausedGoals.map((g) => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        currency={displayCurrency}
                        onEdit={() => openGoalEditor(g)}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Rules tab ── */}
        <TabsContent value="rules" className="space-y-4">
          {rules.isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : ruleList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <ListChecks className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("rules.empty")}</p>
                <Button size="sm" onClick={() => openRuleEditor(null)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("rules.add")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {ruleList.map((r) => (
                <Card key={r.id} className="py-4">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {t(`rules.kind.${r.kind}`)}
                        <Badge
                          variant="secondary"
                          className={
                            r.isActive
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : undefined
                          }
                        >
                          {r.isActive ? t("rules.activeBadge") : t("rules.inactiveBadge")}
                        </Badge>
                        <span className="font-semibold tabular-nums">
                          {r.kind === "CUSTOM"
                            ? r.description
                            : formatRuleValue(fmt, r.kind, r.value, displayCurrency)}
                        </span>
                      </p>
                      {r.description && r.kind !== "CUSTOM" ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {r.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("rules.edit")}
                        onClick={() => openRuleEditor(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("rules.delete")}
                        onClick={() => void onDeleteRule(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Violations tab ── */}
        <TabsContent value="violations" className="space-y-4">
          {violations.isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : violationList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("violations.empty")}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="py-4">
              <CardContent className="px-4">
                <ul className="divide-y">
                  {violationList.map((v, i) => (
                    <li
                      key={`${v.tradeId}-${v.ruleId}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <AlertTriangle
                            className="h-4 w-4 shrink-0 text-rose-500"
                            aria-hidden="true"
                          />
                          {t(`rules.kind.${v.kind}`)}
                        </p>
                        {v.trade ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {v.trade.symbol} · {v.trade.direction} ·{" "}
                            {fmtDateInTz(v.trade.entryTime, timezone)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                        <span>
                          <span className="text-muted-foreground">
                            {t("violations.measured")}
                          </span>{" "}
                          <span className={pnlClass(v.measured)}>
                            {formatMeasuredValue(fmt, v.kind, v.measured, displayCurrency)}
                          </span>
                          {" / "}
                          <span className="text-muted-foreground">
                            {t("violations.limit")}
                          </span>{" "}
                          {formatRuleValue(fmt, v.kind, v.limit, displayCurrency)}
                        </span>
                        {v.trade?.netPnl != null && (
                          <Money
                            signed
                            value={v.trade.netPnl}
                            currency={displayCurrency}
                            className={pnlClass(v.trade.netPnl)}
                          />
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`#/trades/${v.tradeId}`)}
                        >
                          {t("violations.viewTrade")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <GoalEditor
        open={goalEditorOpen}
        onOpenChange={setGoalEditorOpen}
        editing={editingGoal}
        currency={displayCurrency}
      />
      <RuleEditor
        open={ruleEditorOpen}
        onOpenChange={setRuleEditorOpen}
        editing={editingRule}
        currency={displayCurrency}
      />
    </div>
  );
}
