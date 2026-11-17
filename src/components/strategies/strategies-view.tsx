"use client";

/**
 * Strategies view (v1 phase 5) — list with per-strategy stats, full editor
 * (definition + replace-all checklist) and immutable version snapshots.
 * Data: GET /api/strategies?withStats=1 · CRUD /api/strategies[/id] ·
 * POST/GET/DELETE /api/strategies/[id]/versions.
 */
import * as React from "react";
import {
  Camera,
  History,
  Pencil,
  Plus,
  Trash2,
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
import { Progress } from "@/components/ui/progress";
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
  useCreateStrategy,
  useCreateStrategyVersion,
  useDeleteStrategy,
  useDeleteStrategyVersion,
  useStrategiesWithStats,
  useStrategyVersions,
  useUpdateStrategy,
  type StrategyInputBody,
} from "@/hooks/use-journal";
import { useStrategies } from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { TIMEFRAMES } from "@/lib/trading/types";
import type { StrategyDTO, StrategyStatsDTO } from "@/lib/trading/dto";

type ChecklistItem = NonNullable<StrategyInputBody["checklistItems"]>[number];
type ChecklistCategory = ChecklistItem["category"];

const CATEGORIES: ChecklistCategory[] = ["ENTRY", "EXIT", "RISK", "CONTEXT"];

const EMPTY_FORM: StrategyInputBody = {
  name: "",
  description: "",
  color: "#10b981",
  status: "ACTIVE",
  timeframes: [],
  defaultRiskPercent: null,
  targetRR: null,
  entryRules: "",
  exitRules: "",
  riskRules: "",
  checklistItems: [],
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "TESTING":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ── Editor dialog ────────────────────────────────────────────────────────────

function StrategyEditor({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: StrategyDTO | null;
}) {
  const t = useTranslations("strategiesView.form");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateStrategy();
  const update = useUpdateStrategy();

  const [form, setForm] = React.useState<StrategyInputBody>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name,
            description: editing.description ?? "",
            color: editing.color,
            status:
              editing.status === "TESTING" || editing.status === "ARCHIVED"
                ? editing.status
                : "ACTIVE",
            timeframes: editing.timeframes,
            defaultRiskPercent: editing.defaultRiskPercent,
            targetRR: editing.targetRR,
            entryRules: editing.entryRules ?? "",
            exitRules: editing.exitRules ?? "",
            riskRules: editing.riskRules ?? "",
            checklistItems: editing.checklistItems.map((c) => ({
              label: c.label,
              category:
                (CATEGORIES as string[]).includes(c.category)
                  ? (c.category as ChecklistCategory)
                  : "ENTRY",
              order: c.order,
              isRequired: c.isRequired,
            })),
          }
        : EMPTY_FORM,
    );
  }, [open, editing]);

  const set = <K extends keyof StrategyInputBody>(
    key: K,
    value: StrategyInputBody[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const toggleTimeframe = (tf: string) =>
    setForm((f) => ({
      ...f,
      timeframes: f.timeframes?.includes(tf)
        ? f.timeframes.filter((v) => v !== tf)
        : [...(f.timeframes ?? []), tf],
    }));

  const addChecklistItem = () =>
    setForm((f) => ({
      ...f,
      checklistItems: [
        ...(f.checklistItems ?? []),
        { label: "", category: "ENTRY", order: (f.checklistItems?.length ?? 0), isRequired: true },
      ],
    }));

  const setChecklistItem = (index: number, patch: Partial<ChecklistItem>) =>
    setForm((f) => ({
      ...f,
      checklistItems: (f.checklistItems ?? []).map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    }));

  const removeChecklistItem = (index: number) =>
    setForm((f) => ({
      ...f,
      checklistItems: (f.checklistItems ?? []).filter((_, i) => i !== index),
    }));

  const onSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload: StrategyInputBody = {
        ...form,
        checklistItems: (form.checklistItems ?? [])
          .filter((c) => c.label.trim().length > 0)
          .map((c, i) => ({ ...c, order: i })),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Identity */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-name">
                {t("name")}
              </label>
              <Input
                id="strategy-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-color">
                {t("color")}
              </label>
              <Input
                id="strategy-color"
                type="color"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
                className="h-9 w-16 cursor-pointer p-1"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-desc">
              {t("description")}
            </label>
            <Input
              id="strategy-desc"
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value || null)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={5000}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-status">
                {t("status")}
              </label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as StrategyInputBody["status"])}
              >
                <SelectTrigger id="strategy-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">{t("statusActive")}</SelectItem>
                  <SelectItem value="TESTING">{t("statusTesting")}</SelectItem>
                  <SelectItem value="ARCHIVED">{t("statusArchived")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-risk">
                {t("riskPercent")}
              </label>
              <Input
                id="strategy-risk"
                inputMode="decimal"
                value={form.defaultRiskPercent ?? ""}
                onChange={(e) =>
                  set("defaultRiskPercent", e.target.value.trim() === "" ? null : e.target.value.trim())
                }
                placeholder="0.5"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="strategy-rr">
                {t("targetRR")}
              </label>
              <Input
                id="strategy-rr"
                inputMode="decimal"
                value={form.targetRR ?? ""}
                onChange={(e) =>
                  set("targetRR", e.target.value.trim() === "" ? null : e.target.value.trim())
                }
                placeholder="2"
              />
            </div>
          </div>

          {/* Timeframes */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("timeframes")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TIMEFRAMES.map((tf) => {
                const active = form.timeframes?.includes(tf) ?? false;
                return (
                  <button
                    key={tf}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTimeframe(tf)}
                    className={[
                      "rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rules */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("rules.title")}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {(["entryRules", "exitRules", "riskRules"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor={`rules-${key}`}>
                    {t(`rules.${key === "entryRules" ? "entry" : key === "exitRules" ? "exit" : "risk"}`)}
                  </label>
                  <Textarea
                    id={`rules-${key}`}
                    value={form[key] ?? ""}
                    onChange={(e) => set(key, e.target.value || null)}
                    rows={4}
                    className="resize-y text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Checklist */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("checklist.title")}</p>
            {(form.checklistItems ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t("checklist.empty")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {(form.checklistItems ?? []).map((item, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                  >
                    <Input
                      value={item.label}
                      onChange={(e) => setChecklistItem(index, { label: e.target.value })}
                      placeholder={t("checklist.labelPlaceholder")}
                      maxLength={200}
                      className="min-w-[140px] flex-1"
                    />
                    <Select
                      value={item.category}
                      onValueChange={(v) =>
                        setChecklistItem(index, { category: v as ChecklistCategory })
                      }
                    >
                      <SelectTrigger className="w-[120px]" aria-label={t("checklist.category")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={item.isRequired}
                        onCheckedChange={(v) =>
                          setChecklistItem(index, { isRequired: v === true })
                        }
                        aria-label={t("checklist.required")}
                      />
                      {t("checklist.required")}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeChecklistItem(index)}
                      aria-label={t("checklist.remove")}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addChecklistItem}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("checklist.add")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void onSave()} disabled={saving || !form.name.trim()}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const t = useTranslations("strategiesView.versions");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { data: versions, isLoading } = useStrategyVersions(
    open ? strategy?.id ?? null : null,
  );
  const createVersion = useCreateStrategyVersion();
  const deleteVersion = useDeleteStrategyVersion();
  const [note, setNote] = React.useState("");

  const onSnapshot = async () => {
    if (!strategy) return;
    try {
      const v = await createVersion.mutateAsync({
        strategyId: strategy.id,
        note: note.trim() || null,
      });
      toast({ title: t("createdToast", { version: v.version }) });
      setNote("");
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(tRoot, err?.code, error instanceof Error ? error.message : ""),
        variant: "destructive",
      });
    }
  };

  const onDelete = async (versionId: string, version: number) => {
    if (!strategy) return;
    if (!window.confirm(t("deleteConfirm", { version }))) return;
    try {
      await deleteVersion.mutateAsync({ strategyId: strategy.id, versionId });
      toast({ title: t("deletedToast") });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              maxLength={500}
            />
            <Button
              size="sm"
              onClick={() => void onSnapshot()}
              disabled={createVersion.isPending || !strategy}
            >
              <Camera className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("snapshot")}
            </Button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (versions ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(versions ?? []).map((v) => (
                <li key={v.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <Badge variant="secondary" className="tabular-nums">
                          {t("versionLabel", { version: v.version })}
                        </Badge>
                        <span className="truncate">{v.snapshot.name}</span>
                      </p>
                      {v.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">{v.note}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString()} ·{" "}
                        {t("checklistCount", { count: v.snapshot.checklistItems.length })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDelete(v.id, v.version)}
                      aria-label={t("delete")}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function StrategiesView() {
  const t = useTranslations("strategiesView");
  const tRoot = useTranslations();
  const { toast } = useToast();

  const { data, isLoading } = useStrategies();
  // Stats ride on a separate cached query so the selector reuse stays intact.
  const { data: statsData } = useStrategiesWithStats();
  const statsById = React.useMemo(() => {
    const map = new Map<string, StrategyStatsDTO>();
    for (const s of statsData ?? []) map.set(s.key, s);
    return map;
  }, [statsData]);

  const del = useDeleteStrategy();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StrategyDTO | null>(null);
  const [versionsOf, setVersionsOf] = React.useState<StrategyDTO | null>(null);
  const strategies = data ?? [];

  const onEdit = (s: StrategyDTO) => {
    setEditing(s);
    setEditorOpen(true);
  };
  const onNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const onDelete = async (s: StrategyDTO) => {
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
    <section aria-labelledby="strategies-title" className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="strategies-title" className="text-2xl font-bold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("newStrategy")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : strategies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
            <Button size="sm" onClick={onNew}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("newStrategy")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {strategies.map((s) => {
            const stats = statsById.get(s.id);
            const st = stats?.stats;
            return (
              <Card key={s.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{s.name}</span>
                    <Badge className={`ml-auto ${statusBadgeClass(s.status)}`}>
                      {s.status === "ACTIVE"
                        ? t("form.statusActive")
                        : s.status === "TESTING"
                          ? t("form.statusTesting")
                          : t("form.statusArchived")}
                    </Badge>
                  </CardTitle>
                  {s.description ? (
                    <CardDescription className="line-clamp-2">{s.description}</CardDescription>
                  ) : null}
                  <CardAction className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(s)} aria-label={t("edit")}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setVersionsOf(s)}
                      aria-label={t("versions.title")}
                    >
                      <History className="h-4 w-4" aria-hidden="true" />
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
                  {s.checklistItems.length > 0 ? (
                    <ul className="flex flex-wrap gap-1">
                      {s.checklistItems.slice(0, 6).map((c) => (
                        <li key={c.id}>
                          <Badge variant="outline" className="max-w-[220px] truncate font-normal">
                            {c.label}
                          </Badge>
                        </li>
                      ))}
                      {s.checklistItems.length > 6 ? (
                        <li>
                          <Badge variant="outline" className="tabular-nums">
                            +{s.checklistItems.length - 6}
                          </Badge>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                  {st && st.tradeCount > 0 ? (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-[11px] text-muted-foreground">{t("stats.trades")}</p>
                        <p className="font-semibold tabular-nums">{st.tradeCount}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">{t("stats.netPnl")}</p>
                        <p className={`font-semibold tabular-nums ${pnlClass(st.netPnl)}`}>
                          <Money signed value={st.netPnl} currency="USD" />
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">{t("stats.winRate")}</p>
                        <p className="font-semibold tabular-nums">
                          {st.winRate != null ? `${Number(st.winRate).toFixed(0)} %` : "-"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("stats.noTrades")}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <StrategyEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />
      <VersionsDialog
        strategy={versionsOf}
        open={versionsOf != null}
        onOpenChange={(open) => {
          if (!open) setVersionsOf(null);
        }}
      />
    </section>
  );
}
