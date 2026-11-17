"use client";

/**
 * v2.5 Module 2 — annotation manager (#/analytics/annotations, spec §4.7).
 *
 * The equity curve annotated with the user's annotations (vertical lines for
 * points, translucent bands for ranges — vertical bands in time). Create by
 * clicking the chart, edit/delete from the list, filter by kind, toggle
 * visibility, and a before/after popover per annotation (win rate,
 * expectancy, drawdown, sample sizes, not-significant warning). Scope
 * global/account/strategy. Annotations are part of the SVG → included in
 * PNG exports of this chart.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBuilderData } from "@/hooks/use-charts";
import { useAccounts, useStrategies } from "@/hooks/use-trading";
import { useI18n } from "@/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Money, Sensitive } from "@/components/privacy/money";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { navigate } from "@/lib/router";
import { fmtNum } from "@/lib/format";
import { useFormat, type FormatApi } from "@/lib/format/use-format";
import {
  ANNOTATION_KINDS,
  ANNOTATION_SCOPES,
} from "@/lib/validations/charts";
import {
  annotationApplies,
  beforeAfterStats,
  type Annotation,
} from "@/lib/charts/annotations";
import { downloadTextFile, exportSvgToPng } from "@/lib/charts/export-png";

const KIND_COLORS: Record<string, string> = {
  STRATEGY_CHANGE: "var(--chart-2)",
  VACATION: "var(--chart-4)",
  BAD_PERIOD: "var(--loss)",
  NEWS: "var(--chart-5)",
  RULE_CHANGE: "var(--chart-3)",
  OTHER: "var(--muted-foreground)",
};

export function AnnotationsView() {
  const t = useTranslations("chartsBuilder.annotations");
  const tCommon = useTranslations("common");
  const { locale } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const { reducedMotionActive } = useA11yPrefs();

  const [visible, setVisible] = React.useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = React.useState<string>("all");
  const [editing, setEditing] = React.useState<Annotation | null>(null);
  const [creating, setCreating] = React.useState<string | null>(null); // ISO date
  const [selected, setSelected] = React.useState<Annotation | null>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);

  const accounts = useAccounts();
  const strategies = useStrategies();
  const data = useBuilderData({ period: "all", account: null });
  const annotationsQuery = useQuery({
    queryKey: ["charts", "annotations"],
    queryFn: async () =>
      (await apiFetch<{ annotations: Annotation[] }>(
        "/api/charts/annotations"
      )).annotations,
    staleTime: 60 * 1000,
  });
  const removeAnnotation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/charts/annotations/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["charts", "annotations"] });
      toast({ title: t("deletedToast") });
    },
  });

  const annotations = annotationsQuery.data ?? [];
  const trades = data.data?.trades ?? [];
  const currency = data.data?.currency ?? "USD";

  // All annotations visible by default.
  React.useEffect(() => {
    setVisible((prev) => {
      if (prev.size > 0 || annotations.length === 0) return prev;
      return new Set(annotations.map((a) => a.id));
    });
  }, [annotations]);

  // Equity chart data (all-time).
  const chartData = React.useMemo(() => {
    const initial = 10000;
    const sorted = [...trades].sort(
      (a, b) =>
        new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime() ||
        a.id.localeCompare(b.id)
    );
    // Cumulative P&L via reduce (React Compiler-friendly, no reassignment).
    return sorted.reduce<
      Array<{ i: number; date: string; ms: number; equity: number }>
    >((acc, tr) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].equity : initial;
      acc.push({
        i: acc.length + 1,
        date: tr.exitTime,
        ms: new Date(tr.exitTime).getTime(),
        equity: prev + Number(tr.netPnl ?? 0),
      });
      return acc;
    }, []);
  }, [trades]);

  const shown = annotations.filter(
    (a) =>
      visible.has(a.id) && (kindFilter === "all" || a.kind === kindFilter)
  );

  const onChartClick = (e: unknown) => {
    const payload = (e as { activeLabel?: string | number })?.activeLabel;
    if (payload == null) return;
    // activeLabel is the trade index (i) — map back to its exit date.
    const idx = Number(payload) - 1;
    const point = chartData[idx];
    if (point) setCreating(point.date);
  };

  const exportPng = async () => {
    const ok = await exportSvgToPng(chartRef.current, "equity-annotated.png");
    if (!ok) toast({ description: tCommon("error") });
  };

  const selectedStats = React.useMemo(
    () =>
      selected
        ? beforeAfterStats(trades, selected)
        : null,
    [selected, trades]
  );

  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(iso)
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => navigate("#/analytics")}>
            {tCommon("back")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreating(new Date().toISOString())}>
            <Plus aria-hidden="true" />
            {t("create")}
          </Button>
        </div>
      </div>

      {/* Annotated equity chart */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">{t("chartTitle")}</CardTitle>
            <CardDescription>{t("chartDesc")}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-8 w-44" aria-label={t("filterKind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allKinds")}</SelectItem>
                {ANNOTATION_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" onClick={() => void exportPng()}>
              PNG
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.isLoading || annotationsQuery.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("noData")}
            </p>
          ) : (
            <div ref={chartRef} className="h-72 w-full" role="img" aria-label={t("chartTitle")}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                  onClick={onChartClick}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
                  <XAxis
                    dataKey="i"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                    tickFormatter={(v: number) => `#${v}`}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => fmt.money(v, currency, 0)}
                  />
                  <Tooltip
                    cursor={{ strokeOpacity: 0.4 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]?.payload) return null;
                      const p = payload[0].payload as { date: string; equity: number };
                      return (
                        <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{fmtDay(p.date)}</p>
                          <p className="font-mono">
                            <Money
                              value={p.equity}
                              currency={currency}
                              kind="balance"
                            />
                          </p>
                          <p className="text-muted-foreground">{t("clickToAnnotate")}</p>
                        </div>
                      );
                    }}
                  />
                  {/* Range annotations: translucent vertical bands */}
                  {shown
                    .filter((a) => a.endDate != null)
                    .map((a) => (
                      <ReferenceArea
                        key={`area-${a.id}`}
                        x1={(() => {
                          const idx = chartData.findIndex(
                            (p) => p.ms >= new Date(a.date).getTime()
                          );
                          return idx >= 0 ? idx + 1 : 1;
                        })()}
                        x2={(() => {
                          const idx = chartData.findIndex(
                            (p) => p.ms >= new Date(a.endDate!).getTime()
                          );
                          return idx >= 0 ? idx + 1 : chartData.length;
                        })()}
                        fill={a.color ?? KIND_COLORS[a.kind] ?? KIND_COLORS.OTHER}
                        fillOpacity={0.12}
                        stroke={a.color ?? KIND_COLORS[a.kind] ?? KIND_COLORS.OTHER}
                        strokeOpacity={0.4}
                        strokeDasharray="4 2"
                      />
                    ))}
                  {/* Annotations: vertical lines */}
                  {shown.map((a) => (
                    <ReferenceLine
                      key={a.id}
                      x={(() => {
                        const idx = chartData.findIndex(
                          (p) => p.ms >= new Date(a.date).getTime()
                        );
                        return idx >= 0 ? idx + 1 : 1;
                      })()}
                      stroke={a.color ?? KIND_COLORS[a.kind] ?? KIND_COLORS.OTHER}
                      strokeWidth={a.endDate == null ? 2 : 0}
                      strokeDasharray="6 3"
                      label={{
                        value: a.label.slice(0, 14),
                        position: "insideTopLeft",
                        fill: "var(--muted-foreground)",
                        fontSize: 10,
                      }}
                      ifOverflow="extendDomain"
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="equity"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="var(--chart-1)"
                    fillOpacity={0.12}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={!reducedMotionActive}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("clickHint")}</p>
        </CardContent>
      </Card>

      {/* Before/after popover for the selected annotation */}
      {selected && selectedStats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("statsTitle", { label: selected.label })}
            </CardTitle>
            <CardDescription>
              {fmtDay(selected.date)}
              {selected.endDate ? ` → ${fmtDay(selected.endDate)}` : ""} ·{" "}
              {t(`kinds.${selected.kind}` as never)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedStats.notSignificant && (
              <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-muted-foreground">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-amber-500" />
                {t("notSignificant")}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div />
              <div className="font-medium">{t("before")}</div>
              <div className="font-medium">{t("after")}</div>
              {[
                { label: t("sTrades"), b: selectedStats.before.n, a: selectedStats.after.n },
                {
                  label: t("sWinRate"),
                  b: selectedStats.before.winRate,
                  a: selectedStats.after.winRate,
                  pct: true,
                },
                {
                  label: t("sExpectancy"),
                  b: selectedStats.before.expectancyR,
                  a: selectedStats.after.expectancyR,
                  r: true,
                },
                {
                  label: t("sNetPnl"),
                  b: selectedStats.before.netPnl,
                  a: selectedStats.after.netPnl,
                  money: true,
                },
                {
                  label: t("sMaxDd"),
                  b: selectedStats.before.maxDrawdown,
                  a: selectedStats.after.maxDrawdown,
                  money: true,
                },
              ].map((row) => (
                <React.Fragment key={row.label}>
                  <div className="text-left text-muted-foreground">{row.label}</div>
                  <div className="font-mono">{fmtSide(row.b, row, fmt, currency)}</div>
                  <div className="font-mono">{fmtSide(row.a, row, fmt, currency)}</div>
                </React.Fragment>
              ))}
            </div>
            {selected.note && (
              <p className="text-sm text-muted-foreground">{selected.note}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("listTitle")}</CardTitle>
          <CardDescription>{t("listDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {annotations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {annotations.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-8 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        a.color ?? KIND_COLORS[a.kind] ?? KIND_COLORS.OTHER,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDay(a.date)}
                      {a.endDate ? ` → ${fmtDay(a.endDate)}` : ""} ·{" "}
                      {t(`kinds.${a.kind}` as never)} ·{" "}
                      {a.scope === "GLOBAL"
                        ? t("scopeGlobal")
                        : a.scope === "ACCOUNT"
                          ? (
                              <Sensitive kind="account">
                                {accounts.data?.find((x) => x.id === a.accountId)
                                  ?.name ?? "?"}
                              </Sensitive>
                            )
                          : strategies.data?.find((x) => x.id === a.strategyId)?.name ?? "?"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={visible.has(a.id) ? t("hide") : t("show")}
                    onClick={() =>
                      setVisible((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      })
                    }
                  >
                    {visible.has(a.id) ? (
                      <Eye aria-hidden="true" />
                    ) : (
                      <EyeOff aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(selected?.id === a.id ? null : a)}
                  >
                    {t("stats")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={tCommon("delete")}
                    onClick={() => void removeAnnotation.mutateAsync(a.id)}
                  >
                    <Trash2 aria-hidden="true" className="text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <AnnotationDialog
        open={creating != null || editing != null}
        initialDate={creating ?? editing?.date ?? new Date().toISOString()}
        annotation={editing}
        accounts={accounts.data ?? []}
        strategies={strategies.data ?? []}
        onClose={() => {
          setCreating(null);
          setEditing(null);
        }}
      />
    </div>
  );
}

function fmtSide(
  v: number | null,
  row: { pct?: boolean; r?: boolean; money?: boolean },
  fmt: FormatApi,
  currency: string
): string {
  if (v == null) return "-";
  if (row.pct) return fmt.pct(v, 1);
  if (row.r) return `${fmtNum(v, 2)} R`;
  if (row.money) return fmt.money(v, currency, 0);
  return String(v);
}

// ── Create / edit dialog ─────────────────────────────────────────────────────

function AnnotationDialog({
  open,
  initialDate,
  annotation,
  accounts,
  strategies,
  onClose,
}: {
  open: boolean;
  initialDate: string;
  annotation: Annotation | null;
  accounts: Array<{ id: string; name: string }>;
  strategies: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const t = useTranslations("chartsBuilder.annotations");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [kind, setKind] = React.useState<string>("OTHER");
  const [scope, setScope] = React.useState<string>("GLOBAL");
  const [accountId, setAccountId] = React.useState("");
  const [strategyId, setStrategyId] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel(annotation?.label ?? "");
    setNote(annotation?.note ?? "");
    setKind(annotation?.kind ?? "OTHER");
    setScope(annotation?.scope ?? "GLOBAL");
    setAccountId(annotation?.accountId ?? "");
    setStrategyId(annotation?.strategyId ?? "");
    setEndDate(
      annotation?.endDate != null
        ? new Date(annotation.endDate).toISOString().slice(0, 10)
        : ""
    );
  }, [open, annotation]);

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const body = {
        date: annotation?.date ?? initialDate,
        endDate: endDate ? new Date(`${endDate}T12:00:00.000Z`).toISOString() : null,
        label: label.trim(),
        note: note.trim() || null,
        kind,
        scope,
        accountId: scope === "ACCOUNT" ? accountId || null : null,
        strategyId: scope === "STRATEGY" ? strategyId || null : null,
      };
      if (annotation) {
        await apiFetch(`/api/charts/annotations/${annotation.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/charts/annotations", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      toast({ title: annotation ? t("updatedToast") : t("createdToast") });
      void qc.invalidateQueries({ queryKey: ["charts", "annotations"] });
      onClose();
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const dayValue = new Date(initialDate).toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {annotation ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>
            {annotation
              ? t("editDesc")
              : t("createDesc", { date: dayValue })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-label">{t("labelLabel")}</Label>
            <Input
              id="ann-label"
              value={label}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("kindLabel")}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANNOTATION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kinds.${k}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-end">{t("endDateLabel")}</Label>
              <Input
                id="ann-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("scopeLabel")}</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANNOTATION_SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`scopes.${s}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {scope === "ACCOUNT" && (
            <div className="space-y-1.5">
              <Label>{t("accountLabel")}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("accountPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {scope === "STRATEGY" && (
            <div className="space-y-1.5">
              <Label>{t("strategyLabel")}</Label>
              <Select value={strategyId} onValueChange={setStrategyId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("strategyPlaceholder")} />
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
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ann-note">{t("noteLabel")}</Label>
            <Textarea
              id="ann-note"
              value={note}
              className="h-20"
              placeholder={t("notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || !label.trim()}>
            {annotation ? tCommon("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
