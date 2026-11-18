"use client";

/**
 * v2.5 Module 2 — benchmark comparison page (/analytics/benchmark, spec §4.5).
 *
 * Overlays the realized equity curve against a benchmark (fixed % per period
 * compounding/linear, fixed R per period, or an imported custom CSV series),
 * both normalized to 100 at the common start. Shows the gap, the share of
 * beaten periods, a goal calculator (required monthly return) and a simple
 * assumption-labelled projection cone. Profiles are saved per user.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Calculator,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
import { PageHeader } from "@/components/ui/page-header";
import { Money } from "@/components/privacy/money";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { navigate } from "@/lib/router";
import { fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import type { AnalyticsPayload } from "@/lib/trading/dto";
import {
  buildFixedBenchmark,
  compareEquityToBenchmark,
  monthlyReturns,
  projectionCone,
  requiredMonthlyReturn,
  type BenchmarkParams,
} from "@/lib/charts/benchmark";

interface BenchmarkProfileDTO {
  id: string;
  name: string;
  type: string;
  params: unknown;
  series: Array<{ date: string; value: number }> | null;
  createdAt: string;
}

interface EquityInput {
  date: string;
  equity: number;
}

const DEFAULT_PARAMS: BenchmarkParams = {
  percent: 1,
  period: "MONTH",
  compounding: true,
  startDate: "",
};

export function BenchmarkView() {
  const t = useTranslations("chartsBuilder.benchmark");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const qc = useQueryClient();
  const fmt = useFormat();
  const { reducedMotionActive } = useA11yPrefs();

  const [selectedId, setSelectedId] = React.useState<string>("default");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [goal, setGoal] = React.useState("");

  const analytics = useQuery({
    queryKey: ["analytics", "all", "all"],
    queryFn: async () =>
      apiFetch<AnalyticsPayload>("/api/analytics?period=all"),
    staleTime: 60 * 1000,
  });
  const benchmarks = useQuery({
    queryKey: ["charts", "benchmarks"],
    queryFn: async () =>
      (await apiFetch<{ benchmarks: BenchmarkProfileDTO[] }>(
        "/api/charts/benchmarks"
      )).benchmarks,
    staleTime: 60 * 1000,
  });
  const deleteBenchmark = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/charts/benchmarks/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setSelectedId("default");
      void qc.invalidateQueries({ queryKey: ["charts", "benchmarks"] });
      toast({ title: t("deletedToast") });
    },
  });

  const equity: EquityInput[] = React.useMemo(
    () =>
      (analytics.data?.equityCurve ?? []).map((p) => ({
        date: p.date,
        equity: Number(p.equity),
      })),
    [analytics.data]
  );
  const initialBalance = Number(
    analytics.data?.equityInitialBalance ?? 10000
  );
  const currentEquity = equity.length > 0 ? equity[equity.length - 1].equity : initialBalance;
  const currency = analytics.data?.currency ?? "USD";

  // The default benchmark starts at the first equity date.
  const firstDate = equity.length > 0 ? equity[0].date : new Date().toISOString();

  const benchmarkSeries = React.useMemo(() => {
    if (selectedId === "default") {
      return buildFixedBenchmark(
        { ...DEFAULT_PARAMS, startDate: firstDate, startBalance: String(initialBalance) },
        equity.length > 0 ? equity[equity.length - 1].date : new Date().toISOString()
      );
    }
    const profile = benchmarks.data?.find((b) => b.id === selectedId);
    if (!profile) return [];
    if (profile.type === "CUSTOM_SERIES" && profile.series) {
      return profile.series
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => ({ date: `${p.date}T00:00:00.000Z`, value: p.value }));
    }
    const params = profile.params as BenchmarkParams;
    return buildFixedBenchmark(
      {
        ...params,
        startDate: params.startDate || firstDate,
        startBalance:
          params.startBalance ?? String(initialBalance),
      },
      equity.length > 0 ? equity[equity.length - 1].date : new Date().toISOString()
    );
  }, [selectedId, benchmarks.data, firstDate, initialBalance, equity]);

  const comparison = React.useMemo(
    () => compareEquityToBenchmark(equity, benchmarkSeries, { unit: "MONTH" }),
    [equity, benchmarkSeries]
  );

  const chartData = React.useMemo(
    () =>
      comparison.points.map((p) => ({
        date: p.date,
        label: new Intl.DateTimeFormat(undefined, {
          month: "short",
          year: "2-digit",
        }).format(new Date(p.date)),
        equity: p.equityIndex,
        benchmark: p.benchmarkIndex,
      })),
    [comparison]
  );

  const realizedMonthly = React.useMemo(() => monthlyReturns(equity), [equity]);
  const cone = React.useMemo(
    () => projectionCone(realizedMonthly, currentEquity, 12),
    [realizedMonthly, currentEquity]
  );

  const goalValue = Number(goal);
  const monthsLeft = React.useMemo(() => {
    // Months left in the current year.
    const now = new Date();
    return 12 - now.getMonth();
  }, []);
  const required = React.useMemo(() => {
    if (!Number.isFinite(goalValue) || goalValue <= 0) return null;
    return requiredMonthlyReturn(currentEquity, goalValue, monthsLeft);
  }, [goalValue, currentEquity, monthsLeft]);

  const selectedProfile = benchmarks.data?.find((b) => b.id === selectedId);

  return (
    <div className="space-y-6">
      {/* Header + sub-nav */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-1" role="tablist">
          <Button variant="outline" size="sm" onClick={() => navigate("/analytics")}>
            {tCommon("back")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void analytics.refetch()}
            aria-label={tCommon("refresh")}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          </div>
        }
      />

      {/* Profile selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">{t("profile")}</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {t("defaultProfile", { percent: DEFAULT_PARAMS.percent ?? 1 })}
                </SelectItem>
                {(benchmarks.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            {t("newProfile")}
          </Button>
          {selectedProfile && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("deleteProfile")}
              onClick={() => void deleteBenchmark.mutateAsync(selectedProfile.id)}
            >
              <Trash2 aria-hidden="true" className="text-destructive" />
            </Button>
          )}
          <p className="ml-auto text-xs text-muted-foreground">
            {t("baseBalance", {
              amount: fmt.money(initialBalance, currency),
            })}
          </p>
        </CardContent>
      </Card>

      {/* Comparison chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("chartTitle")}</CardTitle>
          <CardDescription>{t("chartDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("noData")}
            </p>
          ) : (
            <>
              <div className="h-72 w-full" role="img" aria-label={t("chartTitle")}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) => fmtNum(v, 0)}
                    />
                    <Tooltip
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="font-medium">{label}</p>
                            {payload.map((e) => (
                              <p key={e.dataKey as string} className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  {e.dataKey === "equity" ? t("equityLine") : t("benchmarkLine")}
                                </span>
                                <span className="font-mono">{fmtNum(e.value as number, 1)}</span>
                              </p>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                    <ReferenceLine y={100} stroke="var(--border)" />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      name={t("equityLine")}
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={!reducedMotionActive}
                    />
                    <Line
                      type="monotone"
                      dataKey="benchmark"
                      name={t("benchmarkLine")}
                      stroke="var(--chart-3)"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={!reducedMotionActive}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Stats */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCell
                  label={t("gapAtEnd")}
                  value={
                    comparison.gapAtEnd != null
                      ? `${comparison.gapAtEnd >= 0 ? "+" : ""}${fmtNum(comparison.gapAtEnd, 1)}`
                      : "-"
                  }
                  tone={
                    comparison.gapAtEnd == null
                      ? ""
                      : comparison.gapAtEnd >= 0
                        ? "text-gain"
                        : "text-loss"
                  }
                />
                <StatCell
                  label={t("beatRate")}
                  value={
                    comparison.beatRate != null
                      ? fmt.pct(comparison.beatRate, 0)
                      : "-"
                  }
                />
                <StatCell
                  label={t("periodsCompared")}
                  value={String(comparison.periods.length)}
                />
                <StatCell
                  label={t("currentEquity")}
                  value={
                    <Money
                      value={currentEquity}
                      currency={currency}
                      kind="balance"
                    />
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Goal + projection cone */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target aria-hidden="true" className="h-4 w-4" />
              {t("goalTitle")}
            </CardTitle>
            <CardDescription>{t("goalDesc", { months: monthsLeft })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="goal-balance">{t("goalLabel")}</Label>
                <Input
                  id="goal-balance"
                  type="number"
                  min={0}
                  placeholder="20000"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </div>
              <div className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm">
                <Calculator aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                {required != null ? (
                  <span className={required >= 0 ? "text-gain" : "text-loss"}>
                    {required >= 0 ? "+" : ""}
                    {fmtNum(required, 2)} %/{t("month")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("goalPlaceholder")}</span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("goalNote")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp aria-hidden="true" className="h-4 w-4" />
              {t("coneTitle")}
            </CardTitle>
            <CardDescription>{t("coneDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {cone == null ? (
              <p className="text-sm text-muted-foreground">{t("coneNeedData")}</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">{t("coneLow")}</p>
                    <Money
                      value={cone.low[11]}
                      currency={currency}
                      kind="balance"
                      className="font-mono text-sm text-loss"
                    />
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">{t("coneBase")}</p>
                    <Money
                      value={cone.base[11]}
                      currency={currency}
                      kind="balance"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="rounded-md border p-2">
                    <p className="text-muted-foreground">{t("coneHigh")}</p>
                    <Money
                      value={cone.high[11]}
                      currency={currency}
                      kind="balance"
                      className="font-mono text-sm text-gain"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("coneAssumption", {
                    mean: fmtNum(cone.meanMonthlyReturn, 2),
                    std: fmtNum(cone.stdMonthlyReturn, 2),
                    n: realizedMonthly.length,
                  })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateBenchmarkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        firstDate={firstDate}
        initialBalance={initialBalance}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}

function StatCell({ label, value, tone = "" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-mono text-lg ${tone}`}>{value}</p>
    </div>
  );
}

// ── Create dialog ────────────────────────────────────────────────────────────

function CreateBenchmarkDialog({
  open,
  onOpenChange,
  firstDate,
  initialBalance,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firstDate: string;
  initialBalance: number;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("chartsBuilder.benchmark");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<"FIXED_PERCENT_PER_PERIOD" | "FIXED_R_PER_PERIOD" | "CUSTOM_SERIES">(
    "FIXED_PERCENT_PER_PERIOD"
  );
  const [percent, setPercent] = React.useState("1");
  const [rPerPeriod, setRPerPeriod] = React.useState("2");
  const [period, setPeriod] = React.useState<"MONTH" | "WEEK" | "YEAR">("MONTH");
  const [compounding, setCompounding] = React.useState(true);
  const [csv, setCsv] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const series =
        type === "CUSTOM_SERIES" && csv
          ? csv
              .trim()
              .split(/\r?\n/)
              .slice(1)
              .map((line) => line.split(/[,;]/))
              .filter((p) => p.length >= 2)
              .map((p) => ({ date: p[0].trim(), value: Number(p[1]) }))
              .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
          : undefined;
      const res = await apiFetch<{ benchmark: BenchmarkProfileDTO }>(
        "/api/charts/benchmarks",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            type,
            params: {
              percent: type === "FIXED_PERCENT_PER_PERIOD" ? Number(percent) : undefined,
              rPerPeriod: type === "FIXED_R_PER_PERIOD" ? Number(rPerPeriod) : undefined,
              period,
              compounding,
              startDate: firstDate,
              startBalance: String(initialBalance),
            },
            series,
          }),
        }
      );
      toast({ title: t("createdToast") });
      onOpenChange(false);
      setName("");
      setCsv("");
      void qc.invalidateQueries({ queryKey: ["charts", "benchmarks"] });
      onCreated(res.benchmark.id);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("newProfile")}</DialogTitle>
          <DialogDescription>{t("newProfileDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bench-name">{t("nameLabel")}</Label>
            <Input
              id="bench-name"
              value={name}
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("typeLabel")}</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED_PERCENT_PER_PERIOD">{t("typePercent")}</SelectItem>
                <SelectItem value="FIXED_R_PER_PERIOD">{t("typeR")}</SelectItem>
                <SelectItem value="CUSTOM_SERIES">{t("typeCustom")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "FIXED_PERCENT_PER_PERIOD" && (
            <div className="space-y-1.5">
              <Label htmlFor="bench-percent">{t("percentLabel")}</Label>
              <Input
                id="bench-percent"
                type="number"
                step="0.1"
                min={0}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </div>
          )}
          {type === "FIXED_R_PER_PERIOD" && (
            <div className="space-y-1.5">
              <Label htmlFor="bench-r">{t("rLabel")}</Label>
              <Input
                id="bench-r"
                type="number"
                step="0.1"
                min={0}
                value={rPerPeriod}
                onChange={(e) => setRPerPeriod(e.target.value)}
              />
            </div>
          )}
          {type !== "CUSTOM_SERIES" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("periodLabel")}</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTH">{t("periodMonth")}</SelectItem>
                    <SelectItem value="WEEK">{t("periodWeek")}</SelectItem>
                    <SelectItem value="YEAR">{t("periodYear")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type === "FIXED_PERCENT_PER_PERIOD" && (
                <div className="flex items-center justify-between">
                  <Label htmlFor="bench-comp">{t("compounding")}</Label>
                  <Switch id="bench-comp" checked={compounding} onCheckedChange={setCompounding} />
                </div>
              )}
            </>
          )}
          {type === "CUSTOM_SERIES" && (
            <div className="space-y-1.5">
              <Label htmlFor="bench-csv">{t("csvLabel")}</Label>
              <input
                id="bench-csv"
                type="file"
                accept=".csv,text/csv"
                className="text-sm"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">{t("csvFormat")}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => void create()} disabled={busy || !name.trim()}>
            <Plus aria-hidden="true" />
            {tCommon("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
