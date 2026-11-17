"use client";

/**
 * Playbook view (Phase 2) — the written trading plan.
 *
 * Seven tabs persisted in ?tab= (overview, strategies, setups, rules,
 * checklists, performance, templates). Data: /api/playbook/*, /api/setups/*,
 * /api/strategies/stats. Full strategy editing stays in #/strategies; this
 * page focuses on health, versions, duplication, setups, rules and
 * compliance.
 */
import * as React from "react";
import {
  BookOpen,
  Copy,
  History,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useDeleteStrategy,
  useDeleteStrategyVersion,
  useStrategyVersions,
} from "@/hooks/use-journal";
import {
  useChecklistTemplates,
  useCreateChecklistTemplate,
  useCreatePlaybookRule,
  useCreateSetup,
  useDeleteChecklistTemplate,
  useDeletePlaybookRule,
  useDeleteSetup,
  useDuplicateStrategy,
  useInstallExampleRules,
  useInstallGlobalChecklist,
  useInstantiateTemplate,
  usePlaybookOverview,
  usePlaybookRules,
  usePlaybookStats,
  usePlaybookStrategies,
  usePlaybookTemplates,
  useSetupInsights,
  useSetups,
  useUpdateChecklistTemplate,
  useUpdatePlaybookRule,
  useUpdateSetup,
} from "@/hooks/use-playbook";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { navigate, useHashRoute } from "@/lib/router";
import type {
  ChecklistTemplateDTO,
  PlaybookRuleDTO,
  SetupDTO,
  SetupInsightDTO,
  StrategyDTO,
  StrategyHealthFlag,
  StrategyStatsDTO,
} from "@/lib/trading/dto";
import type {
  ChecklistTemplateInput,
  PlaybookRuleInput,
  SetupInput,
} from "@/lib/validations/playbook";

const TABS = [
  "overview",
  "strategies",
  "setups",
  "rules",
  "checklists",
  "performance",
  "templates",
] as const;

type TabId = (typeof TABS)[number];

function isTab(value: string | undefined): value is TabId {
  return (TABS as readonly string[]).includes(value ?? "");
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "TESTING":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "DRAFT":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "PAUSED":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Cumulative-R sparkline (inline SVG, real data only). */
function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length === 0) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) =>
    values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1] as number;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className={last >= 0 ? "text-gain" : "text-loss"}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.5" fill="currentColor" />
    </svg>
  );
}

function HealthFlags({ flags }: { flags: StrategyHealthFlag[] }) {
  const t = useTranslations("playbook");
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <li key={f}>
          <Badge variant="outline" className="font-normal">
            {t(`health.${f}`)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

// ── Versions dialog ──────────────────────────────────────────────────────────

function VersionsDialog({
  strategy,
  open,
  onOpenChange,
}: {
  strategy: StrategyDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("playbook.strategies");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: versions, isLoading } = useStrategyVersions(
    open ? (strategy?.id ?? null) : null,
  );
  const deleteVersion = useDeleteStrategyVersion();

  const onDelete = async (versionId: string, version: number) => {
    if (!strategy) return;
    if (!window.confirm(t("deleteVersionConfirm", { version }))) return;
    try {
      await deleteVersion.mutateAsync({ strategyId: strategy.id, versionId });
      toast({ title: t("versionDeleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title:
          err?.code === "PROTECTED"
            ? t("versionProtected")
            : apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("versionsTitle", { name: strategy?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("versionsDesc")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (versions ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t("versionsEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(versions ?? []).map((v) => (
              <li key={v.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Badge variant="secondary" className="tabular-nums">
                        {t("versionLabel", { version: v.version })}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="font-normal"
                        title={t("versionOriginHint")}
                      >
                        {v.origin === "AUTO" ? t("versionAuto") : t("versionManual")}
                      </Badge>
                      <span className="truncate">{v.snapshot.name}</span>
                    </p>
                    {v.note ? (
                      <p className="mt-1 text-xs text-muted-foreground">{v.note}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString()} ·{" "}
                      {t("versionChecklistCount", {
                        count: v.snapshot.checklistItems.length,
                      })}
                    </p>
                  </div>
                  {v.origin !== "AUTO" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDelete(v.id, v.version)}
                      aria-label={t("deleteVersion", { version: v.version })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Duplicate dialog ─────────────────────────────────────────────────────────

function DuplicateDialog({
  strategy,
  open,
  onOpenChange,
}: {
  strategy: StrategyDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("playbook.strategies");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const duplicate = useDuplicateStrategy();
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (open && strategy) setName(`${strategy.name} (copy)`);
  }, [open, strategy]);

  const onConfirm = async () => {
    if (!strategy || !name.trim()) return;
    try {
      await duplicate.mutateAsync({ id: strategy.id, name: name.trim() });
      toast({ title: t("duplicated") });
      onOpenChange(false);
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("duplicateTitle")}</DialogTitle>
          <DialogDescription>{t("duplicateDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="duplicate-name">
            {t("duplicateName")}
          </label>
          <Input
            id="duplicate-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={duplicate.isPending || !name.trim()}
          >
            {t("duplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const t = useTranslations("playbook.overview");
  const tUnder = useTranslations("playbook.underperforming");
  const { data, isLoading } = usePlaybookOverview();
  const { data: strategies } = usePlaybookStrategies();
  const nameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of strategies ?? []) map.set(s.id, s.name);
    return map;
  }, [strategies]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }
  if (!data) return null;
  const c = data.counts;
  const comp = data.compliance;

  return (
    <div className="flex flex-col gap-4">
      {data.underperforming ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-semibold">{tUnder("title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tUnder("body", {
                name: data.underperforming.name,
                count: data.underperforming.trades20,
                expectancy: data.underperforming.expectancyR20,
              })}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("complianceTitle")}</CardTitle>
            <CardDescription>{t("complianceDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {comp.reviewed === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noReviewed")}</p>
            ) : (
              <>
                <p className="text-3xl font-bold tabular-nums">
                  {comp.scorePct != null ? `${comp.scorePct} %` : "-"}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {t("score")}
                  </span>
                </p>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  {(
                    [
                      ["matched", comp.matched],
                      ["partial", comp.partial],
                      ["offPlaybook", comp.offPlaybook],
                      ["unreviewed", comp.unreviewed],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-[11px] text-muted-foreground">{t(key)}</p>
                      <p className="font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("reviewed")}: {comp.reviewed} / {comp.reviewed + comp.unreviewed}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("countsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              {(
                [
                  ["strategies", c.totalStrategies],
                  ["active", c.active],
                  ["draft", c.draft],
                  ["paused", c.paused],
                  ["testing", c.testing],
                  ["archived", c.archived],
                  ["setups", c.totalSetups],
                  ["rules", c.totalRules],
                  ["checklists", c.totalChecklists],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <p className="text-[11px] text-muted-foreground">{t(key)}</p>
                  <p className="font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            {data.recentlyUsed.length > 0 ? (
              <div>
                <p className="text-[11px] text-muted-foreground">
                  {t("recentlyUsed")}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {data.recentlyUsed.map((s) => (
                    <li key={s.strategyId} className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {s.tradesCount} {t("trades")} ·{" "}
                        {s.lastTradeAt
                          ? new Date(s.lastTradeAt).toLocaleDateString()
                          : t("neverTraded")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("healthTitle")}</CardTitle>
          <CardDescription>{t("healthDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.health.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("healthEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.health.map((h) => {
                return (
                  <li
                    key={h.strategyId}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <span className="text-sm font-medium">
                      {nameById.get(h.strategyId) ?? h.strategyId}
                    </span>
                    <HealthFlags flags={h.flags} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Strategies tab ───────────────────────────────────────────────────────────

function StrategiesTab() {
  const t = useTranslations("playbook.strategies");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data, isLoading } = usePlaybookStrategies();
  const { data: statsData } = usePlaybookStats();
  const { data: overview } = usePlaybookOverview();
  const del = useDeleteStrategy();

  const statsById = React.useMemo(() => {
    const map = new Map<string, StrategyStatsDTO>();
    for (const s of statsData ?? []) map.set(s.key, s);
    return map;
  }, [statsData]);
  const healthById = React.useMemo(() => {
    const map = new Map<string, StrategyHealthFlag[]>();
    for (const h of overview?.health ?? []) map.set(h.strategyId, h.flags);
    return map;
  }, [overview]);

  const [versionsOf, setVersionsOf] = React.useState<StrategyDTO | null>(null);
  const [duplicateOf, setDuplicateOf] = React.useState<StrategyDTO | null>(null);

  const onDelete = async (s: StrategyDTO) => {
    const confirmed = window.confirm(
      (s.tradeCount ?? 0) > 0
        ? t("deleteWarning", { count: s.tradeCount ?? 0 })
        : t("deleteConfirm", { name: s.name }),
    );
    if (!confirmed) return;
    try {
      await del.mutateAsync(s.id);
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }
  if ((data ?? []).length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate("#/strategies")}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("newStrategy")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {(data ?? []).map((s) => {
          const st = statsById.get(s.id);
          const flags = healthById.get(s.id) ?? [];
          return (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{s.name}</span>
                  <Badge className={`ml-auto shrink-0 ${statusBadgeClass(s.status)}`}>
                    {s.status}
                  </Badge>
                </CardTitle>
                {s.description ? (
                  <CardDescription className="line-clamp-2">{s.description}</CardDescription>
                ) : null}
                <CardAction className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("#/strategies")}
                    aria-label={t("editInStrategies")}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setVersionsOf(s)}
                    aria-label={t("versions")}
                  >
                    <History className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDuplicateOf(s)}
                    aria-label={t("duplicate")}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void onDelete(s)}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="tabular-nums">
                    v{s.version}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {t("grade")}: {s.grade ?? t("noGrade")}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {t("setupsCount", { count: s.setups?.length ?? 0 })}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {t("tradesAttached", { count: s.tradeCount ?? 0 })}
                  </Badge>
                  {st?.underperforming ? (
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      {t("underperformingBadge")}
                    </Badge>
                  ) : null}
                </div>
                <HealthFlags flags={flags} />
                {st && (st.sparklineR.length > 0 || (st.stats?.tradeCount ?? 0) > 0) ? (
                  <div className="flex items-end justify-between gap-3">
                    <Sparkline
                      values={st.sparklineR}
                      label={t("sparklineLabel", { name: s.name })}
                    />
                    <div className="text-right text-sm">
                      <p className="text-[11px] text-muted-foreground">
                        {t("expectancy20")}
                      </p>
                      <p className="font-semibold tabular-nums">
                        {st.expectancyR20 != null ? `${Number(st.expectancyR20).toFixed(2)}R` : "-"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("sparklineEmpty")}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <VersionsDialog
        strategy={versionsOf}
        open={versionsOf != null}
        onOpenChange={(open) => {
          if (!open) setVersionsOf(null);
        }}
      />
      <DuplicateDialog
        strategy={duplicateOf}
        open={duplicateOf != null}
        onOpenChange={(open) => {
          if (!open) setDuplicateOf(null);
        }}
      />
    </>
  );
}

// ── Setup form dialog ────────────────────────────────────────────────────────

const EMPTY_SETUP: SetupInput = {
  strategyId: "",
  name: "",
  description: "",
  status: "ACTIVE",
  context: "",
  marketCondition: null,
  trigger: "",
  confirmation: "",
  entryModel: "",
  stopModel: "",
  targetModel: "",
  invalidation: "",
  notes: "",
  tags: [],
};

const MARKET_CONDITIONS = [
  "TRENDING",
  "RANGING",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "EXPANSION",
  "COMPRESSION",
  "BULLISH_STRUCTURE",
  "BEARISH_STRUCTURE",
  "NEUTRAL_STRUCTURE",
] as const;

function SetupDialog({
  open,
  onOpenChange,
  editing,
  strategies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SetupDTO | null;
  strategies: StrategyDTO[];
}) {
  const t = useTranslations("playbook.setups");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateSetup();
  const update = useUpdateSetup();
  const [form, setForm] = React.useState<SetupInput>(EMPTY_SETUP);
  const [tagsText, setTagsText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        strategyId: editing.strategyId,
        name: editing.name,
        description: editing.description ?? "",
        status: editing.status as SetupInput["status"],
        context: editing.context ?? "",
        marketCondition: editing.marketCondition as SetupInput["marketCondition"],
        trigger: editing.trigger ?? "",
        confirmation: editing.confirmation ?? "",
        entryModel: editing.entryModel ?? "",
        stopModel: editing.stopModel ?? "",
        targetModel: editing.targetModel ?? "",
        invalidation: editing.invalidation,
        notes: editing.notes ?? "",
        tags: editing.tags,
      });
      setTagsText(editing.tags.join(", "));
    } else {
      setForm({
        ...EMPTY_SETUP,
        strategyId: strategies[0]?.id ?? "",
      });
      setTagsText("");
    }
  }, [open, editing, strategies]);

  const set = <K extends keyof SetupInput>(key: K, value: SetupInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.name.trim() || !form.invalidation.trim() || !form.strategyId) return;
    setSaving(true);
    try {
      const payload: SetupInput = {
        ...form,
        name: form.name.trim(),
        invalidation: form.invalidation.trim(),
        tags: tagsText
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .slice(0, 24),
      };
      if (editing) {
        const { strategyId: _omit, ...patch } = payload;
        await update.mutateAsync({ id: editing.id, patch });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("editSetup") : t("newSetup")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editSetup") : t("newSetup")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-name">
                {t("name")}
              </label>
              <Input
                id="setup-name"
                value={form.name}
                maxLength={120}
                placeholder={t("namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-strategy">
                {t("strategy")}
              </label>
              <Select
                value={form.strategyId}
                onValueChange={(v) => set("strategyId", v)}
                disabled={editing != null}
              >
                <SelectTrigger id="setup-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-context">
              {t("context")}
            </label>
            <Textarea
              id="setup-context"
              value={form.context ?? ""}
              rows={2}
              placeholder={t("contextPlaceholder")}
              onChange={(e) => set("context", e.target.value || null)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-market">
                {t("marketCondition")}
              </label>
              <Select
                value={form.marketCondition ?? "none"}
                onValueChange={(v) =>
                  set("marketCondition", v === "none" ? null : (v as SetupInput["marketCondition"]))
                }
              >
                <SelectTrigger id="setup-market">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  {MARKET_CONDITIONS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-trigger">
                {t("trigger")}
              </label>
              <Input
                id="setup-trigger"
                value={form.trigger ?? ""}
                maxLength={400}
                onChange={(e) => set("trigger", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-confirmation">
                {t("confirmation")}
              </label>
              <Input
                id="setup-confirmation"
                value={form.confirmation ?? ""}
                maxLength={400}
                onChange={(e) => set("confirmation", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-entry">
                {t("entryModel")}
              </label>
              <Input
                id="setup-entry"
                value={form.entryModel ?? ""}
                maxLength={400}
                onChange={(e) => set("entryModel", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-stop">
                {t("stopModel")}
              </label>
              <Input
                id="setup-stop"
                value={form.stopModel ?? ""}
                maxLength={400}
                onChange={(e) => set("stopModel", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-target">
                {t("targetModel")}
              </label>
              <Input
                id="setup-target"
                value={form.targetModel ?? ""}
                maxLength={400}
                onChange={(e) => set("targetModel", e.target.value || null)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-invalidation">
              {t("invalidation")} *
            </label>
            <Input
              id="setup-invalidation"
              value={form.invalidation}
              maxLength={400}
              placeholder={t("invalidationPlaceholder")}
              onChange={(e) => set("invalidation", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{t("invalidationHint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-tags">
                {t("tags")}
              </label>
              <Input
                id="setup-tags"
                value={tagsText}
                placeholder="london, breakout"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="setup-status">
                {t("status")}
              </label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as SetupInput["status"])}
              >
                <SelectTrigger id="setup-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["ACTIVE", "TESTING", "DRAFT", "PAUSED", "ARCHIVED"].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={saving || !form.name.trim() || !form.invalidation.trim() || !form.strategyId}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Setups tab ───────────────────────────────────────────────────────────────

function SetupsTab() {
  const t = useTranslations("playbook.setups");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: strategies } = usePlaybookStrategies();
  const [filter, setFilter] = React.useState<string>("all");
  const { data: setups, isLoading } = useSetups(
    filter === "all" ? null : filter,
  );
  const { data: insights } = useSetupInsights(filter === "all" ? null : filter);
  const del = useDeleteSetup();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SetupDTO | null>(null);

  const insightById = React.useMemo(() => {
    const map = new Map<string, SetupInsightDTO>();
    for (const i of insights ?? []) map.set(i.setupId, i);
    return map;
  }, [insights]);

  const onDelete = async (s: SetupDTO) => {
    if (!window.confirm(t("deleteConfirm", { name: s.name }))) return;
    try {
      await del.mutateAsync(s.id);
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[220px]" aria-label={t("strategy")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStrategies")}</SelectItem>
            {(strategies ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          disabled={(strategies ?? []).length === 0}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("newSetup")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : (setups ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(setups ?? []).map((s) => {
            const ins = insightById.get(s.id);
            return (
              <Card key={s.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="truncate">{s.name}</span>
                    <Badge className={`ml-auto shrink-0 ${statusBadgeClass(s.status)}`}>
                      {s.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {s.strategyName} · {s.tradeCount} {t("trades")}
                  </CardDescription>
                  <CardAction className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                      aria-label={t("editSetup")}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDelete(s)}
                      aria-label={t("deleteConfirm", { name: s.name })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {s.context ? (
                    <p className="text-muted-foreground">{s.context}</p>
                  ) : null}
                  <dl className="grid gap-1.5">
                    {(
                      [
                        [t("trigger"), s.trigger],
                        [t("confirmation"), s.confirmation],
                        [t("entryModel"), s.entryModel],
                        [t("stopModel"), s.stopModel],
                        [t("targetModel"), s.targetModel],
                      ] as const
                    ).map(
                      ([label, value]) =>
                        value ? (
                          <div key={label} className="flex gap-2">
                            <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ) : null,
                    )}
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 font-medium">{t("invalidation")}</dt>
                      <dd className="font-medium">{s.invalidation}</dd>
                    </div>
                  </dl>
                  {ins ? (
                    <div className="rounded-md border p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {t("insightsTitle")}
                        {ins.smallSample ? (
                          <Badge variant="outline" className="ml-2 font-normal">
                            {t("smallSample")}
                          </Badge>
                        ) : null}
                      </p>
                      {ins.trades === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("noTrades")}
                        </p>
                      ) : (
                        <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("winRate")}</p>
                            <p className="font-semibold tabular-nums">
                              {ins.winRatePct != null ? `${ins.winRatePct} %` : "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("totalR")}</p>
                            <p className="font-semibold tabular-nums">
                              {ins.totalR != null ? `${ins.totalR > 0 ? "+" : ""}${ins.totalR}R` : "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("expectancy")}</p>
                            <p className="font-semibold tabular-nums">
                              {ins.expectancyR != null ? `${ins.expectancyR}R` : "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">{t("topInstrument")}</p>
                            <p className="font-semibold">{ins.topInstrument ?? "-"}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <SetupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        strategies={strategies ?? []}
      />
    </div>
  );
}

// ── Rules tab ────────────────────────────────────────────────────────────────

const RULE_CATEGORIES = ["RISK", "SESSION", "NEWS", "BEHAVIOR", "EXECUTION", "CUSTOM"] as const;

const EMPTY_RULE: PlaybookRuleInput = {
  title: "",
  detail: "",
  category: "RISK",
  scope: "GLOBAL",
  strategyId: null,
  evaluatable: false,
  evaluationHint: "",
  active: true,
};

function RuleDialog({
  open,
  onOpenChange,
  editing,
  strategies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PlaybookRuleDTO | null;
  strategies: StrategyDTO[];
}) {
  const t = useTranslations("playbook.rules");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePlaybookRule();
  const update = useUpdatePlaybookRule();
  const [form, setForm] = React.useState<PlaybookRuleInput>(EMPTY_RULE);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            title: editing.title,
            detail: editing.detail,
            category: editing.category as PlaybookRuleInput["category"],
            scope: editing.scope as PlaybookRuleInput["scope"],
            strategyId: editing.strategyId,
            evaluatable: editing.evaluatable,
            evaluationHint: editing.evaluationHint ?? "",
            active: editing.active,
          }
        : EMPTY_RULE,
    );
  }, [open, editing]);

  const set = <K extends keyof PlaybookRuleInput>(key: K, value: PlaybookRuleInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.title.trim()) return;
    if (form.scope === "STRATEGY" && !form.strategyId) return;
    setSaving(true);
    try {
      const payload: PlaybookRuleInput = {
        ...form,
        title: form.title.trim(),
        strategyId: form.scope === "STRATEGY" ? form.strategyId : null,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("editRule") : t("newRule")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editRule") : t("newRule")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-title">
              {t("titleLabel")}
            </label>
            <Input
              id="rule-title"
              value={form.title}
              maxLength={160}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-detail">
              {t("detail")}
            </label>
            <Textarea
              id="rule-detail"
              value={form.detail}
              rows={3}
              maxLength={4000}
              placeholder={t("detailPlaceholder")}
              onChange={(e) => set("detail", e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-category">
                {t("category")}
              </label>
              <Select
                value={form.category}
                onValueChange={(v) => set("category", v as PlaybookRuleInput["category"])}
              >
                <SelectTrigger id="rule-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-scope">
                {t("scope")}
              </label>
              <Select
                value={form.scope}
                onValueChange={(v) => set("scope", v as PlaybookRuleInput["scope"])}
              >
                <SelectTrigger id="rule-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL">{t("scopeGlobal")}</SelectItem>
                  <SelectItem value="STRATEGY">{t("scopeStrategy")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.scope === "STRATEGY" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-strategy">
                {t("strategy")}
              </label>
              <Select
                value={form.strategyId ?? ""}
                onValueChange={(v) => set("strategyId", v)}
              >
                <SelectTrigger id="rule-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.evaluatable}
              onCheckedChange={(v) => set("evaluatable", v === true)}
            />
            {t("evaluatable")}
          </label>
          {form.evaluatable ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-hint">
                {t("evaluationHint")}
              </label>
              <Input
                id="rule-hint"
                value={form.evaluationHint ?? ""}
                maxLength={200}
                onChange={(e) => set("evaluationHint", e.target.value || null)}
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.active} onCheckedChange={(v) => set("active", v === true)} />
            {t("active")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={saving || !form.title.trim() || (form.scope === "STRATEGY" && !form.strategyId)}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesTab() {
  const t = useTranslations("playbook.rules");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: rules, isLoading } = usePlaybookRules();
  const { data: strategies } = usePlaybookStrategies();
  const del = useDeletePlaybookRule();
  const install = useInstallExampleRules();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PlaybookRuleDTO | null>(null);

  const onDelete = async (r: PlaybookRuleDTO) => {
    if (!window.confirm(t("deleteConfirm", { title: r.title }))) return;
    try {
      await del.mutateAsync(r.id);
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  const onInstallExamples = async () => {
    try {
      const added = await install.mutateAsync();
      toast({
        title:
          added === 0
            ? t("examplesNone")
            : t("examplesAdded", { count: added }),
      });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void onInstallExamples()} disabled={install.isPending}>
          {t("addExamples")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("newRule")}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : (rules ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {(rules ?? []).map((r) => (
            <li key={r.id}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span>{r.title}</span>
                    <Badge variant="outline" className="font-normal">
                      {r.category}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {r.scope === "GLOBAL" ? t("scopeGlobal") : (r.strategyName ?? t("scopeStrategy"))}
                    </Badge>
                    {!r.active ? (
                      <Badge variant="secondary" className="font-normal">
                        {t("inactive")}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardAction className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(r);
                        setDialogOpen(true);
                      }}
                      aria-label={t("editRule")}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDelete(r)}
                      aria-label={t("deleteConfirm", { title: r.title })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </CardAction>
                </CardHeader>
                {r.detail ? (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{r.detail}</p>
                    {r.evaluatable && r.evaluationHint ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("evaluationHint")}: {r.evaluationHint}
                      </p>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        strategies={strategies ?? []}
      />
    </div>
  );
}

// ── Checklists tab ───────────────────────────────────────────────────────────

const CHECKLIST_CATEGORIES = ["ENTRY", "EXIT", "RISK", "CONTEXT"] as const;

type ChecklistItemForm = ChecklistTemplateInput["items"][number];

const EMPTY_CHECKLIST: ChecklistTemplateInput = {
  strategyId: null,
  name: "",
  items: [],
};

function ChecklistDialog({
  open,
  onOpenChange,
  editing,
  strategies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ChecklistTemplateDTO | null;
  strategies: StrategyDTO[];
}) {
  const t = useTranslations("playbook.checklists");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateChecklistTemplate();
  const update = useUpdateChecklistTemplate();
  const [form, setForm] = React.useState<ChecklistTemplateInput>(EMPTY_CHECKLIST);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            strategyId: editing.strategyId,
            name: editing.name,
            items: editing.items.map((i) => ({
              label: i.label,
              required: i.required,
              category: i.category as ChecklistItemForm["category"],
            })),
          }
        : EMPTY_CHECKLIST,
    );
  }, [open, editing]);

  const setItem = (index: number, patch: Partial<ChecklistItemForm>) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));

  const onSave = async () => {
    const items = form.items.filter((i) => i.label.trim().length > 0);
    if (!form.name.trim() || items.length === 0) return;
    setSaving(true);
    try {
      const payload: ChecklistTemplateInput = {
        strategyId: form.strategyId,
        name: form.name.trim(),
        items: items.map((i) => ({ ...i, label: i.label.trim() })),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("editChecklist") : t("newChecklist")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editChecklist") : t("newChecklist")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="checklist-name">
                {t("name")}
              </label>
              <Input
                id="checklist-name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="checklist-strategy">
                {t("strategy")}
              </label>
              <Select
                value={form.strategyId ?? "global"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, strategyId: v === "global" ? null : v }))
                }
              >
                <SelectTrigger id="checklist-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t("global")}</SelectItem>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("items")} ({form.items.length}/24)
            </p>
            {form.items.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t("itemsEmpty")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {form.items.map((item, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                  >
                    <Input
                      value={item.label}
                      maxLength={200}
                      placeholder={t("itemPlaceholder")}
                      className="min-w-[140px] flex-1"
                      onChange={(e) => setItem(index, { label: e.target.value })}
                    />
                    <Select
                      value={item.category}
                      onValueChange={(v) =>
                        setItem(index, { category: v as ChecklistItemForm["category"] })
                      }
                    >
                      <SelectTrigger className="w-[110px]" aria-label={t("category")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHECKLIST_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={item.required}
                        onCheckedChange={(v) => setItem(index, { required: v === true })}
                        aria-label={t("required")}
                      />
                      {t("required")}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          items: f.items.filter((_, i) => i !== index),
                        }))
                      }
                      aria-label={t("remove")}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={form.items.length >= 24}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  items: [...f.items, { label: "", required: true, category: "ENTRY" }],
                }))
              }
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("addItem")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={
              saving ||
              !form.name.trim() ||
              form.items.filter((i) => i.label.trim().length > 0).length === 0
            }
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistsTab() {
  const t = useTranslations("playbook.checklists");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: checklists, isLoading } = useChecklistTemplates();
  const { data: strategies } = usePlaybookStrategies();
  const del = useDeleteChecklistTemplate();
  const install = useInstallGlobalChecklist();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ChecklistTemplateDTO | null>(null);

  const onDelete = async (c: ChecklistTemplateDTO) => {
    if (!window.confirm(t("deleteConfirm", { name: c.name }))) return;
    try {
      await del.mutateAsync(c.id);
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  const onInstallGlobal = async () => {
    try {
      await install.mutateAsync();
      toast({ title: t("globalAdded") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void onInstallGlobal()} disabled={install.isPending}>
          {t("addGlobal")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("newChecklist")}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : (checklists ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(checklists ?? []).map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="truncate">{c.name}</span>
                  <Badge variant="outline" className="ml-auto font-normal">
                    {c.strategyId == null ? t("global") : (c.strategyName ?? "")}
                  </Badge>
                </CardTitle>
                <CardAction className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditing(c);
                      setDialogOpen(true);
                    }}
                    aria-label={t("editChecklist")}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void onDelete(c)}
                    aria-label={t("deleteConfirm", { name: c.name })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1.5">
                  {c.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Checkbox checked={false} disabled aria-hidden="true" className="mt-0.5" />
                      <span>
                        {item.label}
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {item.category}
                          {item.required ? ` · ${t("required")}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ChecklistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        strategies={strategies ?? []}
      />
    </div>
  );
}

// ── Performance tab ──────────────────────────────────────────────────────────

function PerformanceTab() {
  const t = useTranslations("playbook.performance");
  const tStrat = useTranslations("playbook.strategies");
  const { data, isLoading } = usePlaybookStats();

  if (isLoading) {
    return <Skeleton className="h-44 w-full" />;
  }
  const rows = (data ?? []).filter((s) => s.stats.tradeCount > 0);
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-semibold">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("desc")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((s) => (
          <Card key={s.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{s.name}</span>
                {s.underperforming ? (
                  <Badge className="ml-auto shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    {tStrat("underperformingBadge")}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">{t("sparkline")}</p>
                  <Sparkline values={s.sparklineR} label={t("sparkline")} />
                </div>
                <div className="text-right text-sm">
                  <p className="text-[11px] text-muted-foreground">{t("expectancy20")}</p>
                  <p className="font-semibold tabular-nums">
                    {s.expectancyR20 != null ? `${Number(s.expectancyR20).toFixed(2)}R` : t("noData")}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground">{t("trades")}</p>
                  <p className="font-semibold tabular-nums">{s.stats.tradeCount}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">{t("winRate")}</p>
                  <p className="font-semibold tabular-nums">
                    {s.stats.winRate != null ? `${Number(s.stats.winRate).toFixed(0)} %` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">{t("netPnl")}</p>
                  <p className={`font-semibold tabular-nums ${pnlClass(s.stats.netPnl)}`}>
                    <Money signed value={s.stats.netPnl} currency="USD" />
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">{t("totalR")}</p>
                  <p className="font-semibold tabular-nums">
                    {s.stats.totalR != null ? `${Number(s.stats.totalR).toFixed(2)}R` : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Templates tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const t = useTranslations("playbook.templates");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: templates, isLoading } = usePlaybookTemplates();
  const instantiate = useInstantiateTemplate();
  const installRules = useInstallExampleRules();
  const installChecklist = useInstallGlobalChecklist();
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const onUse = async (key: string) => {
    setBusyKey(key);
    try {
      await instantiate.mutateAsync({ key });
      toast({ title: t("used") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("starterTitle")}</CardTitle>
          <CardDescription>{t("starterDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={installChecklist.isPending}
            onClick={() => void installChecklist.mutateAsync()}
          >
            {t("addChecklist")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={installRules.isPending}
            onClick={() => void installRules.mutateAsync()}
          >
            {t("addRules")}
          </Button>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t("desc")}</p>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(templates ?? []).map((tpl) => (
            <Card key={tpl.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                <CardDescription>{tpl.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary" className="font-normal">
                    {t("style")}: {tpl.tradingStyle}
                  </Badge>
                  {tpl.marketConditions.map((m) => (
                    <Badge key={m} variant="outline" className="font-normal">
                      {m}
                    </Badge>
                  ))}
                  {tpl.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      #{tag}
                    </Badge>
                  ))}
                </div>
                <div>
                  <Button
                    size="sm"
                    disabled={busyKey === tpl.key}
                    onClick={() => void onUse(tpl.key)}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t("use")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function PlaybookView() {
  const t = useTranslations("playbook");
  const route = useHashRoute();
  const tab: TabId = isTab(route.query?.tab) ? (route.query?.tab as TabId) : "overview";

  return (
    <section aria-labelledby="playbook-title" className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 id="playbook-title" className="text-2xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div
        role="tablist"
        aria-label={t("title")}
        className="flex flex-wrap gap-1.5"
      >
        {TABS.map((id) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => navigate(`#/playbook?tab=${id}`)}
              className={[
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              {t(`tabs.${id}`)}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? <OverviewTab /> : null}
      {tab === "strategies" ? <StrategiesTab /> : null}
      {tab === "setups" ? <SetupsTab /> : null}
      {tab === "rules" ? <RulesTab /> : null}
      {tab === "checklists" ? <ChecklistsTab /> : null}
      {tab === "performance" ? <PerformanceTab /> : null}
      {tab === "templates" ? <TemplatesTab /> : null}
    </section>
  );
}
