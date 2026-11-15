"use client";

/**
 * Trade templates manager (v2 §4.1) — CRUD grid + shared editor dialog.
 *
 * A template pre-fills the quick trade form (instrument, direction, risk,
 * SL/TP in pips, tags, notes). "Use" records the usage and deep-links to
 * #/trades/quick?template=<id>, where the quick form auto-applies it.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  LayoutTemplate,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DirectionBadge,
  Field,
  InstrumentSelect,
  StrategySelect,
  TagsBadges,
  TimeframeSelect,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import {
  useDeleteTemplate,
  useInstruments,
  useRecordTemplateUse,
  useTags,
  useTemplates,
  useUpdateTemplate,
  useCreateTemplate,
} from "@/hooks/use-trading";
import type { TemplateDTO } from "@/lib/trading/dto";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import { navigate } from "@/lib/router";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import type { TemplateInput } from "@/lib/validations/trade";
import { buildTemplateFromForm } from "@/lib/trading/template";
import {
  DIRECTIONS,
  ORDER_TYPES,
  TRADING_SESSIONS,
  type Direction,
  type OrderType,
  type Timeframe,
  type TradingSession,
} from "@/lib/trading/types";
import { fmtDateInTz, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Editor state ─────────────────────────────────────────────────────────────

interface TemplateEditorState {
  name: string;
  strategyId: string;
  instrumentId: string;
  direction: string; // "" | "LONG" | "SHORT"
  timeframe: string;
  session: string; // "" | TradingSession
  orderType: string; // "" | OrderType
  riskPercent: string;
  riskAmount: string;
  lots: string;
  slPips: string;
  tpPips: string;
  tagIds: string[];
  notes: string;
}

function emptyEditor(): TemplateEditorState {
  return {
    name: "",
    strategyId: "",
    instrumentId: "",
    direction: "",
    timeframe: "",
    session: "",
    orderType: "",
    riskPercent: "",
    riskAmount: "",
    lots: "",
    slPips: "",
    tpPips: "",
    tagIds: [],
    notes: "",
  };
}

/** Editor state → TemplateInput (empty numerics → null). */
function editorToInput(
  editor: TemplateEditorState,
  keepChecklistIds: string[]
): TemplateInput {
  const built = buildTemplateFromForm(editor.name, {
    strategyId: editor.strategyId || null,
    instrumentId: editor.instrumentId || null,
    direction: (editor.direction || null) as Direction | null,
    timeframe: (editor.timeframe || null) as Timeframe | null,
    session: (editor.session || null) as TradingSession | null,
    orderType: (editor.orderType || null) as OrderType | null,
    riskPercent: editor.riskPercent.trim() || null,
    riskAmount: editor.riskAmount.trim() || null,
    lots: editor.lots.trim() || null,
    stopLossPips: editor.slPips.trim() || null,
    takeProfitPips: editor.tpPips.trim() || null,
    tagIds: editor.tagIds,
    checklistItemIds: keepChecklistIds,
    notes: editor.notes.trim() || null,
  });
  return {
    ...built,
    timeframe: (built.timeframe as Timeframe | null) ?? null,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function TemplatesView() {
  const t = useTranslations("templates");
  const tc = useTranslations("common");
  const tRoot = useTranslations();
  const labels = useTradingLabels();
  const { toast } = useToast();
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";

  const templatesQuery = useTemplates();
  const templates = templatesQuery.data;
  const { data: instruments } = useInstruments();
  const { data: tags } = useTags();

  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const recordTemplateUse = useRecordTemplateUse();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TemplateDTO | null>(null);
  const [editor, setEditor] = React.useState<TemplateEditorState>(emptyEditor);
  const [nameError, setNameError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const set = <K extends keyof TemplateEditorState>(
    key: K,
    value: TemplateEditorState[K]
  ) => setEditor((f) => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setEditor(emptyEditor());
    setNameError(false);
    setEditorOpen(true);
  };

  const openEdit = (tpl: TemplateDTO) => {
    setEditing(tpl);
    setEditor({
      name: tpl.name,
      strategyId: tpl.strategyId ?? "",
      instrumentId: tpl.instrumentId ?? "",
      direction: tpl.direction ?? "",
      timeframe: tpl.timeframe ?? "",
      session: tpl.session ?? "",
      orderType: tpl.orderType ?? "",
      riskPercent: tpl.defaultRiskPercent ?? "",
      riskAmount: tpl.defaultRiskAmount ?? "",
      lots: tpl.defaultLots ?? "",
      slPips: tpl.defaultStopLossPips ?? "",
      tpPips: tpl.defaultTakeProfitPips ?? "",
      tagIds: [...tpl.defaultTagIds],
      notes: tpl.prefilledNotes ?? "",
    });
    setNameError(false);
    setEditorOpen(true);
  };

  const toggleTag = (id: string) =>
    setEditor((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id)
        ? f.tagIds.filter((x) => x !== id)
        : [...f.tagIds, id],
    }));

  async function saveTemplate() {
    if (!editor.name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setSaving(true);
    try {
      const keepChecklistIds = editing?.defaultChecklistItemIds ?? [];
      const input = editorToInput(editor, keepChecklistIds);
      if (editing) {
        await updateTemplate.mutateAsync({ id: editing.id, patch: input });
        toast({ title: t("updated") });
      } else {
        await createTemplate.mutateAsync(input);
        toast({ title: t("created") });
      }
      setEditorOpen(false);
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(tpl: TemplateDTO) {
    setDeletingId(tpl.id);
    try {
      await deleteTemplate.mutateAsync(tpl.id);
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  const onUse = (tpl: TemplateDTO) => {
    recordTemplateUse.mutate(tpl.id);
    toast({ title: t("useToast") });
    navigate(`#/trades/quick?template=${tpl.id}`);
  };

  // ── Gates ──
  if (templatesQuery.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <Button
            variant="outline"
            onClick={() => void templatesQuery.refetch()}
          >
            {tc("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button size="lg" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("create")}
        </Button>
      </div>

      {/* ── Grid ── */}
      {templatesQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : !templates || templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <LayoutTemplate
              className="h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="max-w-md text-sm text-muted-foreground">{t("empty")}</p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("create")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              timezone={timezone}
              instruments={instruments ?? []}
              tags={tags ?? []}
              deleting={deletingId === tpl.id}
              onUse={() => onUse(tpl)}
              onEdit={() => openEdit(tpl)}
              onDelete={() => void onDelete(tpl)}
            />
          ))}
        </div>
      )}

      {/* ── Editor dialog ── */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editorEditTitle") : t("editorCreateTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Name */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tpl-name">{t("name")}</Label>
              <Input
                id="tpl-name"
                value={editor.name}
                placeholder={t("namePlaceholder")}
                maxLength={80}
                aria-invalid={nameError || undefined}
                onChange={(e) => {
                  set("name", e.target.value);
                  if (nameError) setNameError(false);
                }}
              />
              {nameError && (
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                  {t("invalid")}
                </p>
              )}
            </div>

            {/* Strategy */}
            <Field
              label={t("strategy")}
              htmlFor="tpl-strategy"
              hint={t("strategyHint")}
              className="sm:col-span-2"
            >
              <div className="flex gap-2">
                <StrategySelect
                  id="tpl-strategy"
                  value={editor.strategyId}
                  onChange={(v) => set("strategyId", v)}
                  noneLabel={t("strategyNone")}
                  className="flex-1"
                />
                {editor.strategyId && (
                  <ClearButton
                    label={t("strategyNone")}
                    onClear={() => set("strategyId", "")}
                  />
                )}
              </div>
            </Field>

            <div className="sm:col-span-2">
              <p className="text-sm font-medium">{t("fieldsTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("fieldsHint")}</p>
            </div>

            {/* Instrument */}
            <Field label={t("instrument")} htmlFor="tpl-instrument">
              <div className="flex gap-2">
                <InstrumentSelect
                  id="tpl-instrument"
                  value={editor.instrumentId}
                  onChange={(v) => set("instrumentId", v)}
                  className="flex-1"
                />
                {editor.instrumentId && (
                  <ClearButton
                    label={t("instrumentNone")}
                    onClear={() => set("instrumentId", "")}
                  />
                )}
              </div>
            </Field>

            {/* Direction */}
            <Field label={t("direction")} htmlFor="tpl-direction">
              <Select
                value={editor.direction || "any"}
                onValueChange={(v) => set("direction", v === "any" ? "" : v)}
              >
                <SelectTrigger id="tpl-direction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t("directionAny")}</SelectItem>
                  {DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {labels.direction(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Timeframe */}
            <Field label={t("timeframe")} htmlFor="tpl-timeframe">
              <div className="flex gap-2">
                <TimeframeSelect
                  id="tpl-timeframe"
                  value={editor.timeframe}
                  onChange={(v) => set("timeframe", v)}
                  className="flex-1"
                />
                {editor.timeframe && (
                  <ClearButton
                    label={tc("none")}
                    onClear={() => set("timeframe", "")}
                  />
                )}
              </div>
            </Field>

            {/* Session */}
            <Field label={t("session")} htmlFor="tpl-session">
              <Select
                value={editor.session || "none"}
                onValueChange={(v) => set("session", v === "none" ? "" : v)}
              >
                <SelectTrigger id="tpl-session" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tc("none")}</SelectItem>
                  {TRADING_SESSIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {labels.session(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Order type */}
            <Field label={t("orderType")} htmlFor="tpl-order-type">
              <Select
                value={editor.orderType || "none"}
                onValueChange={(v) => set("orderType", v === "none" ? "" : v)}
              >
                <SelectTrigger id="tpl-order-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tc("none")}</SelectItem>
                  {ORDER_TYPES.map((ot) => (
                    <SelectItem key={ot} value={ot}>
                      {labels.orderType(ot)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Risk / lots / SL / TP pips */}
            <Field label={t("riskPercent")} htmlFor="tpl-risk-percent">
              <Input
                id="tpl-risk-percent"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={editor.riskPercent}
                onChange={(e) => set("riskPercent", e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label={t("riskAmount")} htmlFor="tpl-risk-amount">
              <Input
                id="tpl-risk-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={editor.riskAmount}
                onChange={(e) => set("riskAmount", e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label={t("lots")} htmlFor="tpl-lots">
              <Input
                id="tpl-lots"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={editor.lots}
                onChange={(e) => set("lots", e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label={t("slPips")} htmlFor="tpl-sl-pips">
              <Input
                id="tpl-sl-pips"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={editor.slPips}
                onChange={(e) => set("slPips", e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label={t("tpPips")} htmlFor="tpl-tp-pips">
              <Input
                id="tpl-tp-pips"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={editor.tpPips}
                onChange={(e) => set("tpPips", e.target.value)}
                className="tabular-nums"
              />
            </Field>

            {/* Tags */}
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("tags")}</Label>
              {(tags ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc("none")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(tags ?? []).map((tag) => {
                    const active = editor.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          badgeVariants({
                            variant: active ? "default" : "outline",
                          }),
                          "min-h-9 cursor-pointer gap-1.5 px-3 font-normal",
                          active ? "" : "text-muted-foreground"
                        )}
                        style={
                          active ? { borderColor: `${tag.color}66` } : undefined
                        }
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                          aria-hidden="true"
                        />
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <Field label={t("notes")} htmlFor="tpl-notes" className="sm:col-span-2">
              <Textarea
                id="tpl-notes"
                rows={3}
                value={editor.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              {tc("cancel")}
            </Button>
            <Button onClick={() => void saveTemplate()} disabled={saving}>
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function TemplateCard({
  tpl,
  timezone,
  instruments,
  tags,
  deleting,
  onUse,
  onEdit,
  onDelete,
}: {
  tpl: TemplateDTO;
  timezone: string;
  instruments: Array<{ id: string; symbol: string }>;
  tags: Array<{ id: string; name: string; color: string; kind: string }>;
  deleting: boolean;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("templates");
  const tc = useTranslations("common");

  const symbol = tpl.instrumentId
    ? (instruments.find((i) => i.id === tpl.instrumentId)?.symbol ?? null)
    : null;
  const tagObjects = tags.filter((tag) => tpl.defaultTagIds.includes(tag.id));
  const notes = tpl.prefilledNotes?.trim() ?? "";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tpl.name}</CardTitle>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {t("usage", { count: tpl.usageCount })}
          </p>
          {tpl.lastUsedAt && (
            <p className="text-xs text-muted-foreground">
              {t("lastUsed", { date: fmtDateInTz(tpl.lastUsedAt, timezone) })}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Summary chips */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="font-medium tabular-nums">
            {symbol ?? t("summaryAny")}
          </Badge>
          {tpl.direction && <DirectionBadge direction={tpl.direction} />}
          {tpl.timeframe && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {tpl.timeframe}
            </Badge>
          )}
          {tpl.session && (
            <Badge variant="secondary" className="text-xs">
              <SessionLabel value={tpl.session} />
            </Badge>
          )}
          {tpl.orderType && (
            <Badge variant="secondary" className="text-xs">
              <OrderTypeLabel value={tpl.orderType} />
            </Badge>
          )}
          {tpl.defaultRiskPercent && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              ↗ {fmtNum(tpl.defaultRiskPercent, 2)} %
            </Badge>
          )}
          {tpl.defaultRiskAmount && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {fmtNum(tpl.defaultRiskAmount, 2)}
            </Badge>
          )}
          {tpl.defaultLots && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {fmtNum(tpl.defaultLots, 2)} lots
            </Badge>
          )}
          {tpl.defaultStopLossPips && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              SL {fmtNum(tpl.defaultStopLossPips, 1)} p
            </Badge>
          )}
          {tpl.defaultTakeProfitPips && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              TP {fmtNum(tpl.defaultTakeProfitPips, 1)} p
            </Badge>
          )}
        </div>

        {tagObjects.length > 0 && <TagsBadges tags={tagObjects} />}

        {notes && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {notes.length > 60 ? `${notes.slice(0, 60)}…` : notes}
          </p>
        )}

        {/* Actions */}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onUse}>
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            {t("use")}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t("edit")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={deleting}
                className="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t("delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("confirmDeleteDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>
                  {t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionLabel({ value }: { value: string }) {
  const labels = useTradingLabels();
  return <>{labels.session(value)}</>;
}

function OrderTypeLabel({ value }: { value: string }) {
  const labels = useTradingLabels();
  return <>{labels.orderType(value)}</>;
}

function ClearButton({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClear}
      className="h-9 w-9 shrink-0"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
