"use client";

/**
 * Custom metric builder (v2.5 Module 1, spec §4.6) — the metric editor used
 * by the dashboards settings view.
 *
 * Base aggregate + filter groups (OR inside a group, AND across groups) with
 * checkbox-chip value pickers fed by the reference data (instruments,
 * strategies, tags, accounts…), an optional formula layer over sub-metrics
 * A/B/C (each with its own aggregate + filters) validated live by the safe
 * parser, and an "Evaluate" preview against POST /api/v1/custom-metrics/preview.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useToast } from "@/hooks/use-toast";
import {
  useAccounts,
  useInstruments,
  useStrategies,
  useTags,
} from "@/hooks/use-trading";
import { useCustomMetrics } from "@/hooks/use-dashboards";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { validateFormula } from "@/lib/metrics/parser";
import { fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import type { FormatApi } from "@/lib/format/use-format";
import { EMOTIONS, TRADING_SESSIONS } from "@/lib/trading/types";
import { useSession } from "@/components/app/session-context";
import type { CustomMetricInput } from "@/lib/validations/dashboard";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type MetricFilterField =
  CustomMetricInput["definition"]["filterGroups"][number]["filters"][number]["field"];
type MetricAggregate = CustomMetricInput["definition"]["aggregate"];
type MetricFormat = CustomMetricInput["format"];

const AGGREGATES: readonly MetricAggregate[] = [
  "count",
  "winRate",
  "netPnl",
  "grossWin",
  "grossLoss",
  "avgPnl",
  "medianPnl",
  "avgR",
  "totalR",
  "profitFactor",
  "expectancyR",
  "expectancyCurrency",
  "totalPips",
  "avgLots",
  "avgDurationMin",
  "payoffRatio",
];

const FORMATS: readonly MetricFormat[] = [
  "NUMBER",
  "CURRENCY",
  "PERCENT",
  "R",
  "PIPS",
  "DURATION",
];

const FIELDS: readonly MetricFilterField[] = [
  "instrument",
  "strategy",
  "session",
  "direction",
  "tag",
  "weekday",
  "hourRange",
  "emotion",
  "result",
  "account",
  "setupType",
];

const SUB_NAMES = ["A", "B", "C"] as const;
type SubName = (typeof SUB_NAMES)[number];

interface FilterDraft {
  field: MetricFilterField;
  values: string[];
}

interface GroupDraft {
  filters: FilterDraft[];
}

interface SubMetricDraft {
  enabled: boolean;
  aggregate: MetricAggregate;
  groups: GroupDraft[];
}

interface BuilderState {
  name: string;
  description: string;
  format: MetricFormat;
  aggregate: MetricAggregate;
  groups: GroupDraft[];
  useFormula: boolean;
  expression: string;
  subs: Record<SubName, SubMetricDraft>;
}

const EMPTY_SUB: SubMetricDraft = {
  enabled: false,
  aggregate: "count",
  groups: [],
};

const EMPTY_BUILDER: BuilderState = {
  name: "",
  description: "",
  format: "NUMBER",
  aggregate: "count",
  groups: [],
  useFormula: false,
  expression: "",
  subs: { A: { ...EMPTY_SUB }, B: { ...EMPTY_SUB }, C: { ...EMPTY_SUB } },
};

/** Strip empty filters/groups - the strict server schema rejects them. */
function cleanGroups(groups: GroupDraft[]): CustomMetricInput["definition"]["filterGroups"] {
  return groups
    .map((g) => ({
      filters: g.filters
        .filter((f) => f.values.length > 0)
        .map((f) => ({ field: f.field, values: f.values })),
    }))
    .filter((g) => g.filters.length > 0);
}

function buildInput(state: BuilderState): CustomMetricInput | null {
  const name = state.name.trim();
  if (name === "") return null;

  const useFormula =
    state.useFormula &&
    state.expression.trim() !== "" &&
    validateFormula(state.expression).ok;

  const subMetrics = useFormula
    ? SUB_NAMES.filter((n) => state.subs[n].enabled).map((n) => ({
        name: n,
        aggregate: state.subs[n].aggregate,
        filterGroups: cleanGroups(state.subs[n].groups),
      }))
    : [];

  if (useFormula && subMetrics.length === 0) return null;

  return {
    name,
    description: state.description.trim() === "" ? null : state.description.trim(),
    definition: {
      aggregate: state.aggregate,
      filterGroups: cleanGroups(state.groups),
      formula: useFormula
        ? { expression: state.expression.trim(), subMetrics }
        : null,
    },
    format: state.format,
  };
}

/** Defensively read a saved definition into the builder state. */
function stateFromMetric(metric: {
  name: string;
  description: string | null;
  format: string;
  definition: unknown;
}): BuilderState {
  const def = metric.definition;
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;

  const state: BuilderState = {
    ...EMPTY_BUILDER,
    subs: { A: { ...EMPTY_SUB }, B: { ...EMPTY_SUB }, C: { ...EMPTY_SUB } },
    name: metric.name,
    description: metric.description ?? "",
    format: (FORMATS as readonly string[]).includes(metric.format)
      ? (metric.format as MetricFormat)
      : "NUMBER",
  };

  if (isObject(def)) {
    if ((AGGREGATES as readonly string[]).includes(String(def.aggregate))) {
      state.aggregate = def.aggregate as MetricAggregate;
    }
    if (Array.isArray(def.filterGroups)) {
      state.groups = def.filterGroups
        .filter(isObject)
        .map((g) => ({
          filters: (Array.isArray(g.filters) ? g.filters : [])
            .filter(isObject)
            .filter(
              (f) =>
                (FIELDS as readonly string[]).includes(String(f.field)) &&
                Array.isArray(f.values)
            )
            .map((f) => ({
              field: f.field as MetricFilterField,
              values: (f.values as unknown[]).filter(
                (v): v is string => typeof v === "string"
              ),
            })),
        }))
        .filter((g) => g.filters.length > 0);
    }
    if (isObject(def.formula)) {
      const expression =
        typeof def.formula.expression === "string" ? def.formula.expression : "";
      const subs = Array.isArray(def.formula.subMetrics)
        ? def.formula.subMetrics
        : [];
      if (expression !== "" && subs.length > 0) {
        state.useFormula = true;
        state.expression = expression;
        for (const sub of subs) {
          if (!isObject(sub)) continue;
          const name = String(sub.name);
          if (name !== "A" && name !== "B" && name !== "C") continue;
          const groups = Array.isArray(sub.filterGroups)
            ? (sub.filterGroups as unknown[])
                .filter(isObject)
                .map((g) => ({
                  filters: (Array.isArray(g.filters) ? g.filters : [])
                    .filter(isObject)
                    .filter(
                      (f) =>
                        (FIELDS as readonly string[]).includes(String(f.field)) &&
                        Array.isArray(f.values)
                    )
                    .map((f) => ({
                      field: f.field as MetricFilterField,
                      values: (f.values as unknown[]).filter(
                        (v): v is string => typeof v === "string"
                      ),
                    })),
                }))
                .filter((g) => g.filters.length > 0)
          : [];
          state.subs[name] = {
            enabled: true,
            aggregate: (AGGREGATES as readonly string[]).includes(
              String(sub.aggregate)
            )
              ? (sub.aggregate as MetricAggregate)
              : "count",
            groups,
          };
        }
      }
    }
  }
  return state;
}

// ── Value label helpers ──────────────────────────────────────────────────────

interface ValueOption {
  value: string;
  label: string;
}

function useFieldOptions(): Record<MetricFilterField, ValueOption[]> {
  const tRoot = useTranslations();
  const instruments = useInstruments();
  const strategies = useStrategies();
  const tags = useTags();
  const accounts = useAccounts();
  const tMetric = useTranslations("dashboardsSettings.metric");

  return React.useMemo(() => {
    const weekdays = tMetric.raw("weekdayNames") as unknown as string[];
    const pick = (path: string, v: string): string => {
      try {
        return tRoot(`${path}.${v}` as Parameters<typeof tRoot>[0]);
      } catch {
        return v;
      }
    };
    const uniqueSymbols = Array.from(
      new Set((instruments.data ?? []).map((i) => i.symbol))
    ).sort();
    return {
      instrument: uniqueSymbols.map((s) => ({ value: s, label: s })),
      strategy: (strategies.data ?? []).map((s) => ({
        value: s.name,
        label: s.name,
      })),
      session: TRADING_SESSIONS.map((s) => ({
        value: s,
        label: pick("trading.session", s),
      })),
      direction: (["LONG", "SHORT"] as const).map((d) => ({
        value: d,
        label: pick("trading.direction", d),
      })),
      tag: (tags.data ?? []).map((tag) => ({
        value: tag.name,
        label: tag.name,
      })),
      weekday: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        value: String(n),
        label: weekdays[n - 1] ?? String(n),
      })),
      hourRange: [],
      emotion: EMOTIONS.map((e) => ({
        value: e,
        label: pick("trading.emotion", e),
      })),
      result: (["WIN", "LOSS", "BREAKEVEN"] as const).map((r) => ({
        value: r,
        label: pick("trading.result", r),
      })),
      account: (accounts.data ?? []).map((a) => ({
        value: a.id,
        label: a.name,
      })),
      setupType: [],
    };
  }, [instruments.data, strategies.data, tags.data, accounts.data, tRoot, tMetric]);
}

/** Display label of one stored filter value. */
function useValueLabel() {
  const options = useFieldOptions();
  return React.useCallback(
    (field: MetricFilterField, value: string): string => {
      const found = options[field].find((o) => o.value === value);
      return found?.label ?? value;
    },
    [options]
  );
}

// ── Filter groups editor ─────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${removeLabel} ${label}`}
        className="rounded-full p-0.5 hover:bg-foreground/10"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </Badge>
  );
}

function HourRangeAdder({
  onAdd,
  t,
}: {
  onAdd: (range: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [from, setFrom] = React.useState("8");
  const [to, setTo] = React.useState("10");
  const valid =
    /^\d{1,2}$/.test(from) &&
    /^\d{1,2}$/.test(to) &&
    Number(from) >= 0 &&
    Number(from) < 24 &&
    Number(to) > Number(from) &&
    Number(to) <= 24;
  return (
    <span className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        max={23}
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="h-7 w-14 text-xs"
        aria-label={t("hourFrom")}
      />
      <span className="text-xs text-muted-foreground">→</span>
      <Input
        type="number"
        min={1}
        max={24}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="h-7 w-14 text-xs"
        aria-label={t("hourTo")}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={!valid}
        onClick={() => {
          onAdd(`${Number(from)}-${Number(to)}`);
          setFrom("8");
          setTo("10");
        }}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t("hourAdd")}
      </Button>
    </span>
  );
}

function SetupTypeAdder({
  values,
  onAdd,
  t,
}: {
  values: string[];
  onAdd: (value: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [text, setText] = React.useState("");
  const trimmed = text.trim();
  const valid = trimmed !== "" && trimmed.length <= 60 && !values.includes(trimmed);
  return (
    <span className="flex items-center gap-1">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("setupTypePlaceholder")}
        className="h-7 w-36 text-xs"
        aria-label={t("setupTypePlaceholder")}
        maxLength={60}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={!valid}
        onClick={() => {
          onAdd(trimmed);
          setText("");
        }}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t("setupTypeAdd")}
      </Button>
    </span>
  );
}

function FilterGroupsEditor({
  groups,
  onChange,
}: {
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
}) {
  const t = useTranslations("dashboardsSettings.metric");
  const options = useFieldOptions();
  const valueLabel = useValueLabel();

  const addGroup = () => onChange([...groups, { filters: [] }]);

  const addFilter = (groupIndex: number) => {
    onChange(
      groups.map((g, i) =>
        i !== groupIndex ? g : { filters: [...g.filters, { field: "instrument", values: [] }] }
      )
    );
  };

  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noFilters")}</p>
      ) : null}
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className="space-y-2 rounded-md border border-dashed p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("groupLabel", { index: groupIndex + 1 })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => addFilter(groupIndex)}
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                {t("addFilter")}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={t("removeGroup")}
                onClick={() =>
                  onChange(groups.filter((_, i) => i !== groupIndex))
                }
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {group.filters.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("emptyGroup")}</p>
          ) : null}

          {group.filters.map((filter, filterIndex) => {
            const setFilter = (patch: Partial<FilterDraft>) =>
              onChange(
                groups.map((g, i) =>
                  i !== groupIndex
                    ? g
                    : {
                        filters: g.filters.map((f, j) =>
                          j !== filterIndex ? f : { ...f, ...patch }
                        ),
                      }
                )
              );
            const removeFilter = () =>
              onChange(
                groups.map((g, i) =>
                  i !== groupIndex
                    ? g
                    : { filters: g.filters.filter((_, j) => j !== filterIndex) }
                )
              );
            const toggleValue = (value: string, checked: boolean) => {
              const next = checked
                ? [...filter.values, value]
                : filter.values.filter((v) => v !== value);
              setFilter({ values: next.slice(0, 24) });
            };
            return (
              <div key={filterIndex} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Select
                    value={filter.field}
                    onValueChange={(v) =>
                      setFilter({ field: v as MetricFilterField, values: [] })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-7 w-44 text-xs"
                      aria-label={t("fieldLabel")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>
                          {t(`field.${field}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {t("isOneOf")}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="ml-auto h-7 w-7"
                    aria-label={t("removeFilter")}
                    onClick={removeFilter}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>

                {filter.field === "hourRange" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <HourRangeAdder
                      t={t}
                      onAdd={(range) => {
                        if (!filter.values.includes(range)) {
                          setFilter({ values: [...filter.values, range] });
                        }
                      }}
                    />
                    {filter.values.map((range) => (
                      <FilterChip
                        key={range}
                        label={range}
                        removeLabel={t("removeValue")}
                        onRemove={() => toggleValue(range, false)}
                      />
                    ))}
                  </div>
                ) : filter.field === "setupType" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SetupTypeAdder
                      t={t}
                      values={filter.values}
                      onAdd={(value) => setFilter({ values: [...filter.values, value] })}
                    />
                    {filter.values.map((value) => (
                      <FilterChip
                        key={value}
                        label={value}
                        removeLabel={t("removeValue")}
                        onRemove={() => toggleValue(value, false)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="max-h-40 overflow-y-auto rounded-md border p-2"
                    role="group"
                    aria-label={t(`field.${filter.field}`)}
                  >
                    {options[filter.field].length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("noValues")}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {options[filter.field].map((option) => {
                          const checked = filter.values.includes(option.value);
                          return (
                            <label
                              key={option.value}
                              className={cn(
                                "flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                                checked
                                  ? "border-primary bg-accent font-medium"
                                  : "text-muted-foreground hover:bg-accent"
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) =>
                                  toggleValue(option.value, v === true)
                                }
                                className="h-3.5 w-3.5"
                                aria-label={option.label}
                              />
                              {option.label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Group summary */}
          <p className="text-[11px] text-muted-foreground">
            {groupSummary(group, valueLabel, t)}
          </p>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={addGroup}
        disabled={groups.length >= 6}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t("addGroup")}
      </Button>
    </div>
  );
}

/** "instrument is XAUUSD OR EURUSD" - one line per group. */
function groupSummary(
  group: GroupDraft,
  valueLabel: (field: MetricFilterField, value: string) => string,
  t: ReturnType<typeof useTranslations>
): string {
  const parts = group.filters
    .filter((f) => f.values.length > 0)
    .map(
      (f) =>
        `${t(`field.${f.field}`)} ${t("isOneOf")} ${f.values
          .map((v) => valueLabel(f.field, v))
          .join(` ${t("or")} `)}`
    );
  if (parts.length === 0) return t("emptyGroup");
  return parts.join(` ${t("and")} `);
}

// ── Preview ──────────────────────────────────────────────────────────────────

interface PreviewResult {
  value: string | null;
  sampleSize: number;
  lowSample: boolean;
}

function formatMetricValue(
  fmt: FormatApi,
  value: string | null,
  format: MetricFormat,
  currency: string,
  t: ReturnType<typeof useTranslations>
): string {
  if (value == null) return "-";
  if (value === "inf") return "∞";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  switch (format) {
    case "CURRENCY":
      return fmt.money(n, currency);
    case "PERCENT":
      return fmt.pct(n);
    case "R":
      return `${fmtNum(n)} R`;
    case "PIPS":
      return `${fmtNum(n)} pips`;
    case "DURATION": {
      const h = Math.floor(n / 60);
      const m = Math.round(n % 60);
      return h > 0 ? t("durationHm", { h, m }) : t("durationM", { m });
    }
    default:
      return fmtNum(n);
  }
}

// ── Builder dialog ───────────────────────────────────────────────────────────

export function CustomMetricBuilder({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Metric being edited (null = create). */
  editing: {
    id: string;
    name: string;
    description: string | null;
    format: string;
    definition: unknown;
  } | null;
  onSaved: () => void;
}) {
  const t = useTranslations("dashboardsSettings.metric");
  const tDash = useTranslations("dashboards");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const fmt = useFormat();

  const [state, setState] = React.useState<BuilderState>(EMPTY_BUILDER);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setState(editing ? stateFromMetric(editing) : EMPTY_BUILDER);
    setPreview(null);
  }, [open, editing]);

  const set = (patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch }));

  const formulaCheck =
    state.expression.trim() === ""
      ? null
      : validateFormula(state.expression);

  const input = buildInput(state);

  const onEvaluate = async () => {
    if (input == null) return;
    setPreviewing(true);
    try {
      const result = await apiFetch<PreviewResult>(
        "/api/v1/custom-metrics/preview",
        {
          method: "POST",
          body: JSON.stringify(input.definition),
        }
      );
      setPreview(result);
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
      setPreviewing(false);
    }
  };

  const onSave = async () => {
    if (input == null) return;
    setSaving(true);
    try {
      const response = await apiFetch<{ metric: { id: string } }>(
        editing ? `/api/v1/custom-metrics/${editing.id}` : "/api/v1/custom-metrics",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(input),
        }
      );
      void response;
      toast({
        title: editing ? t("updatedToast") : t("createdToast"),
      });
      onSaved();
      onOpenChange(false);
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
  };

  const canSave = input != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>{t("builderDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cm-name">{t("name")}</Label>
              <Input
                id="cm-name"
                value={state.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={60}
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-format">{t("format")}</Label>
              <Select
                value={state.format}
                onValueChange={(v) => set({ format: v as MetricFormat })}
              >
                <SelectTrigger id="cm-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`format.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-desc">{t("description")}</Label>
            <Input
              id="cm-desc"
              value={state.description}
              onChange={(e) => set({ description: e.target.value })}
              maxLength={280}
              placeholder={t("descriptionPlaceholder")}
            />
          </div>

          {/* Base aggregate */}
          <div className="space-y-1.5">
            <Label htmlFor="cm-aggregate">{t("aggregate")}</Label>
            <Select
              value={state.aggregate}
              onValueChange={(v) => set({ aggregate: v as MetricAggregate })}
            >
              <SelectTrigger id="cm-aggregate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {AGGREGATES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`aggregate.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <Label>{t("filters")}</Label>
            <FilterGroupsEditor
              groups={state.groups}
              onChange={(groups) => set({ groups })}
            />
          </div>

          {/* Advanced — formula */}
          <Collapsible
            open={state.useFormula}
            onOpenChange={(open) => set({ useFormula: open })}
            className="rounded-lg border"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium hover:bg-accent">
              {t("formulaSection")}
              <span className="text-xs font-normal text-muted-foreground">
                {t("formulaHint")}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t p-3">
              <div className="space-y-1.5">
                <Label htmlFor="cm-expression">{t("expression")}</Label>
                <Input
                  id="cm-expression"
                  value={state.expression}
                  onChange={(e) => set({ expression: e.target.value })}
                  className="font-mono text-sm"
                  placeholder="A / B"
                  maxLength={120}
                />
                {formulaCheck == null ? (
                  <p className="text-xs text-muted-foreground">
                    {t("expressionEmpty")}
                  </p>
                ) : formulaCheck.ok ? (
                  <p className="flex items-center gap-1 text-xs text-gain">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("expressionValid")}
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-loss">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(`parserError.${formulaCheck.error}`)}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {["A / B", "A - B", "min(A, B)", "abs(A) * 100"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => set({ expression: chip })}
                    className="rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{t("formulaHelp")}</p>

              {/* Sub metrics A/B/C */}
              <div className="space-y-2">
                {SUB_NAMES.map((name) => {
                  const sub = state.subs[name];
                  const setSub = (patch: Partial<SubMetricDraft>) =>
                    setState((s) => ({
                      ...s,
                      subs: { ...s.subs, [name]: { ...s.subs[name], ...patch } },
                    }));
                  return (
                    <div
                      key={name}
                      className="space-y-2 rounded-md border p-2.5"
                      data-sub-enabled={sub.enabled}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-sm font-medium">
                          <Checkbox
                            checked={sub.enabled}
                            onCheckedChange={(v) =>
                              setSub({ enabled: v === true })
                            }
                            aria-label={t("subEnabled", { name })}
                          />
                          {t("subMetric", { name })}
                        </label>
                        <Select
                          value={sub.aggregate}
                          onValueChange={(v) =>
                            setSub({ aggregate: v as MetricAggregate })
                          }
                          disabled={!sub.enabled}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-7 w-52 text-xs"
                            aria-label={t("subAggregate", { name })}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {AGGREGATES.map((a) => (
                              <SelectItem key={a} value={a}>
                                {t(`aggregate.${a}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {sub.enabled ? (
                        <FilterGroupsEditor
                          groups={sub.groups}
                          onChange={(groups) => setSub({ groups })}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Live preview */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {t("previewTitle")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={input == null || previewing}
                onClick={() => void onEvaluate()}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {previewing ? t("evaluating") : t("evaluate")}
              </Button>
            </div>
            {preview ? (
              <div className="space-y-1.5">
                <p className="text-2xl font-bold tabular-nums">
                  {formatMetricValue(fmt, preview.value, state.format, currency, t)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tDash("metricSample", { count: preview.sampleSize })}
                </p>
                {preview.lowSample ? (
                  <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {tDash("metricLowSample")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("previewHint")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void onSave()} disabled={!canSave || saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomMetricsSection() {
  const t = useTranslations("dashboardsSettings.metric");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const metrics = useCustomMetrics();
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{
    id: string;
    name: string;
    description: string | null;
    format: string;
    definition: unknown;
  } | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const list = metrics.data ?? [];

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await apiFetch<void>(`/api/v1/custom-metrics/${id}`, { method: "DELETE" });
      toast({ title: t("deletedToast") });
      void metrics.refetch();
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
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("listDesc")}</p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setBuilderOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("create")}
        </Button>
      </div>

      {metrics.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((metric) => {
            const aggregate = aggregateOf(metric.definition);
            return (
              <li
                key={metric.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{metric.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {aggregate ? t(`aggregate.${aggregate}`) : "-"}
                    {" · "}
                    {t(`format.${metric.format}`)}
                    {metric.description ? ` - ${metric.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit")}
                    onClick={() => {
                      setEditing(metric);
                      setBuilderOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete")}
                    disabled={deletingId === metric.id}
                    onClick={() => void onDelete(metric.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CustomMetricBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        editing={editing}
        onSaved={() => void metrics.refetch()}
      />
    </div>
  );
}

function aggregateOf(definition: unknown): string | null {
  if (typeof definition !== "object" || definition === null) return null;
  const aggregate = (definition as Record<string, unknown>).aggregate;
  return typeof aggregate === "string" ? aggregate : null;
}
