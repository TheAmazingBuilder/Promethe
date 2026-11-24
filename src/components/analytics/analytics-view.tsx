"use client";

/**
 * Analytics view (v2 Phase 4) — GET /api/v1/analytics (useAnalytics).
 *
 * Layout: filters (period tabs + account select) → KPI grid → equity curve
 * with drawdown + R distribution → insights « ce qui marche / ce qui coûte »
 * → multi-dimension breakdowns. All money formatted in the profile currency,
 * weekday/hour dimensions in the user's timezone (computed server-side).
 */
import * as React from "react";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CalendarDays,
  Coins,
  Compass,
  DoorOpen,
  Gauge,
  Grid3x3,
  FileText,
  Info,
  LineChart,
  ListChecks,
  Plus,
  RotateCw,
  Scale,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/ui/page-header";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { Money, Sensitive } from "@/components/privacy/money";
import { useTradingLabels } from "@/components/trades/trade-bits";
import { MonthlyReportDialog } from "@/components/reports/monthly-report-dialog";
import dynamic from "next/dynamic";
import { WhenYouTradeSection } from "@/components/analytics/when-you-trade-section";

// Equity / R-distribution charts (recharts) load on demand after the KPIs
// and filters - the analytics shell never waits on the chart chunk.
import type { EquityDatum } from "./analytics-charts";
const AnalyticsCharts = dynamic(
  () => import("./analytics-charts").then((m) => m.AnalyticsCharts),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[340px] w-full" />,
  }
);
import { useSession } from "@/components/app/session-context";
import { useI18n } from "@/i18n/i18n-provider";
import { useAccounts, useAnalytics } from "@/hooks/use-trading";
import { useCustomFields } from "@/hooks/use-productivity";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import type { GroupStat } from "@/lib/analytics/engine";
import type { Insight } from "@/lib/analytics/insights";
import {
  fmtNum,
  fmtSigned,
  pnlClass,
} from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";

const EMERALD = "text-gain";
const ROSE = "text-loss";

const PERIODS: AnalyticsPeriod[] = ["30d", "90d", "ytd", "all"];

// ── Small building blocks ────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  valueClassName,
  sub,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  sub?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`tabular-nums ${
          compact ? "text-xl font-semibold" : "text-2xl font-bold"
        } ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      {sub != null ? (
        <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}


/** One breakdown dimension - compact rows with a proportional net P&L bar. */
function BreakdownCard({
  title,
  description,
  icon: Icon,
  entries,
  currency,
  renderKey,
  max = 8,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  entries: GroupStat[];
  currency: string;
  renderKey: (key: string) => string;
  max?: number;
}) {
  const t = useTranslations("analytics");
  const fmt = useFormat();
  const shown = entries.slice(0, max);
  const maxAbs = shown.reduce(
    (m, e) => Math.max(m, Math.abs(Number(e.stats.netPnl))),
    0
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((e) => {
              const net = Number(e.stats.netPnl);
              const width =
                maxAbs > 0 ? Math.max(2, (Math.abs(net) / maxAbs) * 100) : 0;
              return (
                <li
                  key={e.key}
                  className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm"
                >
                  <span
                    className={`absolute inset-y-0 left-0 ${
                      net >= 0 ? "bg-gain-subtle" : "bg-loss-subtle"
                    }`}
                    style={{ width: `${width}%` }}
                    aria-hidden="true"
                  />
                  <span className="relative z-10 min-w-0 truncate font-medium">
                    {renderKey(e.key)}
                  </span>
                  <span className="relative z-10 flex shrink-0 items-center gap-3 tabular-nums">
                    <span className="text-xs text-muted-foreground">
                      ×{e.stats.tradeCount}
                    </span>
                    <span className="hidden w-16 whitespace-nowrap text-right text-xs text-muted-foreground sm:inline">
                      {e.stats.winRate != null
                        ? fmt.pct(e.stats.winRate)
                        : "-"}
                    </span>
                    <Money
                      signed
                      value={e.stats.netPnl}
                      currency={currency}
                      className={`w-24 text-right font-medium ${pnlClass(
                        e.stats.netPnl
                      )}`}
                    />
                  </span>
                </li>
              );
            })}
            {entries.length > shown.length ? (
              <li className="px-2 pt-1 text-xs text-muted-foreground">
                {t("more", { count: entries.length - shown.length })}
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function AnalyticsView() {
  const { session } = useSession();
  const t = useTranslations("analytics");
  const tAdv = useTranslations("analytics.advanced");
  const tRoot = useTranslations();
  const labels = useTradingLabels();
  const { locale } = useI18n();
  const fmt = useFormat();
  const { reducedMotionActive } = useA11yPrefs();
  const [period, setPeriod] = React.useState<AnalyticsPeriod>("30d");
  const [accountId, setAccountId] = React.useState<string>("all");
  const [reportOpen, setReportOpen] = React.useState(false);
  const tReports = useTranslations("reports");

  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];
  // v2.5 M4 — labels for the custom-field breakdowns below.
  const customFieldDefs = (useCustomFields(false).data ?? []);

  const effectiveAccount = accountId === "all" ? undefined : accountId;
  const { data, isLoading, isError, refetch } = useAnalytics({
    period,
    account: effectiveAccount,
  });

  const timezone = data?.timezone ?? session?.profile.timezone ?? "UTC";
  const currency = data?.currency ?? session?.profile.baseCurrency ?? "USD";
  const stats = data?.stats ?? null;
  const advanced = data?.advanced ?? null;

  const equityData = React.useMemo<EquityDatum[]>(
    () =>
      (data?.equityCurve ?? []).map((p) => ({
        i: p.i,
        date: p.date,
        equity: Number(p.equity),
        drawdown: Number(p.drawdown),
      })),
    [data]
  );

  const rDistData = React.useMemo(
    () =>
      (data?.rDistribution.buckets ?? []).map((b) => ({
        id: b.id,
        label: t(`rdist.${b.id}`),
        count: b.count,
        totalR: Number(b.totalR),
        negative: b.to != null ? b.to <= 0 : false,
      })),
    [data, t]
  );

  const weekdayLabel = React.useCallback(
    (key: string) => {
      try {
        // ISO weekday 1-7 → localized name via a stable reference week
        // (2024-01-01 was a Monday).
        const ref = new Date(Date.UTC(2024, 0, Number(key)));
        return new Intl.DateTimeFormat(locale, {
          weekday: "long",
          timeZone: "UTC",
        }).format(ref);
      } catch {
        return key;
      }
    },
    [locale]
  );

  const hourLabel = React.useCallback((key: string) => {
    const h = Number(key);
    if (!Number.isFinite(h)) return key;
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(h)}:00-${two(h + 1)}:59`;
  }, []);

  /** Formats raw insight params for i18n interpolation (money, R, labels…). */
  const formatInsightParams = React.useCallback(
    (insight: Insight): Record<string, string> => {
      const money = new Set(["netPnl", "fees", "dd", "pnl"]);
      const pct = new Set(["winRate", "pct"]);
      const r = new Set([
        "avgR",
        "avgRPlan",
        "avgRNoPlan",
        "busyAvgR",
        "lightAvgR",
      ]);
      const num = new Set(["payoff", "rf"]);
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(insight.params)) {
        if (money.has(k) && typeof v === "string") {
          out[k] = fmt.signedMoney(v, currency);
        } else if (pct.has(k) && typeof v === "string") {
          out[k] = fmt.pct(v);
        } else if (r.has(k) && typeof v === "string") {
          out[k] = `${fmtSigned(v)} R`;
        } else if (num.has(k) && typeof v === "string") {
          out[k] = fmtNum(v);
        } else if (k === "weekday") {
          out[k] = weekdayLabel(String(v));
        } else if (k === "hour") {
          out[k] = hourLabel(String(v));
        } else if (k === "session") {
          out[k] = labels.session(String(v));
        } else if (k === "emotion") {
          out[k] = labels.emotion(String(v));
        } else {
          out[k] = String(v);
        }
      }
      return out;
    },
    [currency, weekdayLabel, hourLabel, labels, fmt]
  );

  const renderInsight = (insight: Insight) =>
    tRoot(`analytics.insights.${insight.rule}` as Parameters<typeof tRoot>[0], {
      ...formatInsightParams(insight),
    });

  const goodInsights = (data?.insights ?? []).filter((i) => i.tone === "good");
  const badInsights = (data?.insights ?? []).filter((i) => i.tone === "bad");
  const infoInsights = (data?.insights ?? []).filter((i) => i.tone === "info");

  /** KPI display model. */
  const kpi = React.useMemo(() => {
    const s = stats;
    const pfNum = s?.profitFactor != null ? Number(s.profitFactor) : null;
    const streak = s?.currentStreak ?? 0;
    return {
      netPnlTone: s ? pnlClass(s.netPnl) : "text-muted-foreground",
      winRate: s?.winRate != null ? fmt.pct(s.winRate) : "-",
      profitFactor:
        pfNum == null
          ? "-"
          : Number.isFinite(pfNum)
            ? fmtNum(pfNum)
            : "∞",
      profitFactorTone:
        pfNum == null
          ? ""
          : pfNum >= 2
            ? EMERALD
            : pfNum < 1
              ? ROSE
              : "",
      expectancy: s?.expectancyR != null ? `${fmtSigned(s.expectancyR)} R` : "-",
      expectancyTone:
        s?.expectancyR != null ? pnlClass(s.expectancyR) : "text-muted-foreground",
      totalR: s?.totalR != null ? `${fmtSigned(s.totalR)} R` : "-",
      maxDrawdownTone: s?.maxDrawdown != null ? ROSE : "",
      sqn: advanced?.sqn != null ? fmtNum(advanced.sqn) : "-",
      sqnTone:
        advanced?.sqn == null
          ? ""
          : Number(advanced.sqn) >= 2
            ? EMERALD
            : Number(advanced.sqn) < 1
              ? ROSE
              : "",
      tradeCount: s ? fmtNum(s.tradeCount, 0) : "-",
      winsLosses: s
        ? t("kpiWinsLosses", { wins: s.wins, losses: s.losses, be: s.breakevens })
        : null,
      sharpe: advanced?.sharpe != null ? fmtNum(advanced.sharpe) : "-",
      recovery:
        advanced?.recoveryFactor != null ? fmtNum(advanced.recoveryFactor) : "-",
      payoff: advanced?.payoffRatio != null ? fmtNum(advanced.payoffRatio) : "-",
      avgDuration:
        advanced?.avgDurationMin != null
          ? advanced.avgDurationMin >= 60
            ? t("durationHm", {
                h: Math.floor(advanced.avgDurationMin / 60),
                m: advanced.avgDurationMin % 60,
              })
            : t("durationM", { m: advanced.avgDurationMin })
          : "-",
      rCoverage: advanced?.rCoverage != null ? fmt.pct(advanced.rCoverage) : "-",
      maxWinStreak: s ? fmtNum(s.maxWinStreak, 0) : "-",
      maxLossStreak: s ? fmtNum(s.maxLossStreak, 0) : "-",
      streakText:
        streak > 0
          ? t("streakWin", { count: streak })
          : streak < 0
            ? t("streakLoss", { count: Math.abs(streak) })
            : "-",
      streakTone: streak > 0 ? EMERALD : streak < 0 ? ROSE : "",
    };
  }, [stats, advanced, currency, t, fmt]);

  if (!session) return null;

  const hasAnyTrade = stats != null;
  const showAllCta = !hasAnyTrade && period !== "all";

  return (
    <div className="space-y-6" data-tour="analytics">
      {/* ── Header + filters ── */}
      <div className="flex flex-col gap-3">
        <PageHeader
          title={t("title")}
          description={
            hasAnyTrade
              ? t("subtitle", { count: stats.tradeCount })
              : t("subtitleEmpty")
          }
        />
        {/* a11y (M8 Phase 5): wraps at 200 % text / narrow viewports (WCAG 1.4.10). */}
        <div className="flex flex-wrap items-center gap-2">
          {/* a11y (M8 Phase 5): segmented ToggleGroup, NOT Tabs — a tabset
              without panels dangles aria-controls (aria-valid-attr-value). */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={period}
            onValueChange={(v) => {
              if (v && PERIODS.includes(v as AnalyticsPeriod)) {
                setPeriod(v as AnalyticsPeriod);
              }
            }}
          >
            <ToggleGroupItem value="30d">{t("period30d")}</ToggleGroupItem>
            <ToggleGroupItem value="90d">{t("period90d")}</ToggleGroupItem>
            <ToggleGroupItem value="ytd">{t("periodYtd")}</ToggleGroupItem>
            <ToggleGroupItem value="all">{t("periodAll")}</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={accountId}
            onValueChange={(v) => setAccountId(v === "all" ? "all" : v)}
          >
            <SelectTrigger className="w-[180px]" aria-label={t("accountFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allAccounts")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <Sensitive kind="account">{a.name}</Sensitive>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* v2.5 M2 — chart builder deep link */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => navigate("/analytics/charts")}
          >
            <LineChart className="h-4 w-4" aria-hidden="true" />
            {t("openChartBuilder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/analytics/monte-carlo")}
          >
            <Target className="h-4 w-4" aria-hidden="true" />
            {tAdv("tabs.monte-carlo")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/analytics/heatmaps")}
          >
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
            {tRoot("nav.heatmaps")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReportOpen(true)}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {tReports("button")}
          </Button>
        </div>
        {/* v2.5 M6 — advanced analytics tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              "lifecycle",
              "exits",
              "quality",
              "setups",
              "grades",
              "sequences",
              "seasonality",
              "anomalies",
              "weekly-plan",
              "goals",
              "performance-report",
            ] as const
          ).map((tab) => (
            <Button
              key={tab}
              variant="outline"
              size="sm"
              onClick={() => navigate(`/analytics/${tab}`)}
            >
              {tAdv(`tabs.${tab}`)}
            </Button>
          ))}
        </div>
      </div>

      {!isLoading && !isError && data != null && data.excludedTradeCount > 0 ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("currencyScopeNote", {
            count: data.excludedTradeCount,
            currency,
          })}
        </p>
      ) : null}

      {/* ── Loading ── */}
      {isLoading ? (
        <div className="space-y-6" role="status" aria-live="polite">
          <span className="sr-only">{t("loading")}</span>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      ) : isError ? (
        /* ── Error ── */
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium">{t("errorTitle")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t("errorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : !hasAnyTrade || !data ? (
        /* ── Empty state ── */
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("emptyTitle")}</CardTitle>
            <CardDescription>{t("emptyDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {showAllCta ? (
              <Button onClick={() => setPeriod("all")}>
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                {t("emptyCtaAll")}
              </Button>
            ) : (
              <Button onClick={() => navigate("/trades/quick")}>
                <Zap className="h-4 w-4" aria-hidden="true" />
                {t("emptyCtaQuick")}
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/trades/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("emptyCtaForm")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* ── Data state ── */
        <div className="space-y-6">
          {/* KPIs */}
          <section aria-label={t("kpisAria")} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label={t("kpiNetPnl")}
                value={
                  stats ? (
                    <Money signed value={stats.netPnl} currency={currency} />
                  ) : (
                    "-"
                  )
                }
                valueClassName={kpi.netPnlTone}
                sub={kpi.winsLosses ?? undefined}
              />
              <KpiCard
                label={t("kpiWinRate")}
                value={kpi.winRate}
                sub={t("winRateHint", { decided: stats.wins + stats.losses, total: stats.tradeCount })}
              />
              <KpiCard
                label={t("kpiProfitFactor")}
                value={kpi.profitFactor}
                valueClassName={kpi.profitFactorTone}
              />
              <KpiCard
                label={t("kpiExpectancy")}
                value={kpi.expectancy}
                valueClassName={kpi.expectancyTone}
                sub={t("kpiTotalR", { value: kpi.totalR })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                compact
                label={t("kpiMaxDrawdown")}
                value={
                  stats?.maxDrawdown != null ? (
                    <Money value={stats.maxDrawdown} currency={currency} />
                  ) : (
                    "-"
                  )
                }
                valueClassName={kpi.maxDrawdownTone}
                sub={
                  <>
                    {t("kpiRecovery", { value: kpi.recovery })}
                    {" · "}
                    {t("kpiDrawdownHint")}
                  </>
                }
              />
              <KpiCard
                compact
                label={t("kpiSqn")}
                value={kpi.sqn}
                valueClassName={kpi.sqnTone}
                sub={t("sqnHint")}
              />
              <KpiCard
                compact
                label={t("kpiSharpe")}
                value={kpi.sharpe}
                sub={t("riskAdjustedUnavailable")}
              />
              <KpiCard
                compact
                label={t("kpiStreaks")}
                value={kpi.streakText || "-"}
                valueClassName={kpi.streakTone}
                sub={t("streaksMax", {
                  wins: kpi.maxWinStreak,
                  losses: kpi.maxLossStreak,
                })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard compact label={t("kpiPayoff")} value={kpi.payoff} />
              <KpiCard compact label={t("kpiAvgDuration")} value={kpi.avgDuration} />
              <KpiCard
                compact
                label={t("kpiTotalFees")}
                value={
                  advanced != null ? (
                    <Money value={advanced.totalFees} currency={currency} />
                  ) : (
                    "-"
                  )
                }
              />
              <KpiCard compact label={t("kpiRCoverage")} value={kpi.rCoverage} />
            </div>
          </section>

          <AnalyticsCharts
            equityData={equityData}
            rDistData={rDistData}
            currency={currency}
            timezone={timezone}
            reducedMotion={reducedMotionActive}
            formatMoney={(v, c, d) => fmt.money(v, c, d)}
            equityTitle={t("equityTitle")}
            equityDesc={t("equityDesc", {
              amount: fmt.money(data.equityInitialBalance, currency),
            })}
            drawdownTitle={t("drawdownTitle")}
            rdistTitle={t("rdistTitle")}
            rdistDesc={t("rdistDesc")}
            rdistDescMissing={t("rdistDescMissing", {
              count: data.rDistribution.withoutR,
            })}
            missingCount={data.rDistribution.withoutR}
          />

          {/* Insights — ce qui marche / ce qui coûte / à noter */}
          <section aria-label={t("insightsAria")}>
            <h3 className="mb-3 text-base font-semibold">{t("insightsTitle")}</h3>
            <div className="grid gap-4 xl:grid-cols-3">
              {(
                [
                  {
                    key: "works",
                    icon: TrendingUp,
                    tone: EMERALD,
                    bg: "bg-gain-subtle",
                    items: goodInsights,
                  },
                  {
                    key: "costs",
                    icon: TrendingDown,
                    tone: ROSE,
                    bg: "bg-loss-subtle",
                    items: badInsights,
                  },
                  {
                    key: "notes",
                    icon: Info,
                    tone: "text-muted-foreground",
                    bg: "bg-muted",
                    items: infoInsights,
                  },
                ] as const
              ).map((col) => (
                <Card key={col.key}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${col.bg} ${col.tone}`}
                        aria-hidden="true"
                      >
                        <col.icon className="h-4 w-4" />
                      </span>
                      {t(`insights.${col.key}`)}
                      <span className="ml-auto text-xs font-normal text-muted-foreground">
                        {col.items.length}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {col.items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("insightsEmpty")}
                      </p>
                    ) : (
                      <ul className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
                        {col.items.slice(0, 6).map((insight, idx) => (
                          <li
                            key={`${insight.rule}-${idx}`}
                            className={`rounded-md border-l-2 py-1 pl-3 text-sm ${
                              col.key === "works"
                                ? "border-gain-subtle"
                                : col.key === "costs"
                                  ? "border-loss-subtle"
                                  : "border-muted-foreground/40"
                            }`}
                          >
                            {renderInsight(insight)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Breakdowns */}
          <section aria-label={t("breakdownsAria")}>
            <h3 className="mb-3 text-base font-semibold">
              {t("breakdownsTitle")}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <BreakdownCard
                title={t("bdStrategy")}
                icon={Target}
                entries={data.breakdowns.strategy}
                currency={currency}
                renderKey={(k) => k}
              />
              <BreakdownCard
                title={t("bdSymbol")}
                icon={Coins}
                entries={data.breakdowns.symbol}
                currency={currency}
                renderKey={(k) => k}
              />
              <BreakdownCard
                title={t("bdSession")}
                icon={Gauge}
                entries={data.breakdowns.session}
                currency={currency}
                renderKey={(k) => labels.session(k)}
              />
              <BreakdownCard
                title={t("bdWeekday")}
                description={t("bdWeekdayDesc")}
                icon={CalendarDays}
                entries={data.breakdowns.weekday}
                currency={currency}
                renderKey={weekdayLabel}
              />
              <BreakdownCard
                title={t("bdHour")}
                description={t("bdHourDesc")}
                icon={Timer}
                entries={data.breakdowns.hour}
                currency={currency}
                renderKey={hourLabel}
              />
              <BreakdownCard
                title={t("bdSetup")}
                icon={Compass}
                entries={data.breakdowns.setup}
                currency={currency}
                renderKey={(k) => k}
              />
              <BreakdownCard
                title={t("bdExit")}
                icon={DoorOpen}
                entries={data.breakdowns.exit}
                currency={currency}
                renderKey={(k) => labels.exitReason(k)}
              />
              <BreakdownCard
                title={t("bdEmotion")}
                icon={Brain}
                entries={data.breakdowns.emotion}
                currency={currency}
                renderKey={(k) => labels.emotion(k)}
              />
              <BreakdownCard
                title={t("bdDirection")}
                icon={Scale}
                entries={data.breakdowns.direction}
                currency={currency}
                renderKey={(k) => labels.direction(k)}
              />
              <BreakdownCard
                title={t("bdPlan")}
                description={t("bdPlanDesc")}
                icon={ListChecks}
                entries={data.breakdowns.plan}
                currency={currency}
                renderKey={(k) =>
                  k === "yes" ? t("planYes") : t("planNo")
                }
              />
              {/* v2.5 M4 — breakdowns per usable-in-analytics custom field. */}
              {customFieldDefs
                .filter((d) => d.usableInAnalytics)
                .map((def) => {
                  const entries = data.breakdowns.custom?.[def.key] ?? [];
                  if (entries.length === 0) return null;
                  return (
                    <BreakdownCard
                      key={def.key}
                      title={def.label}
                      description={t("bdCustomDesc")}
                      icon={ListChecks}
                      entries={entries}
                      currency={currency}
                      renderKey={(k) => k}
                    />
                  );
                })}
            </div>
          </section>

          {/* When you trade (MRT wave 2) — hour, weekday, session x weekday. */}
          <WhenYouTradeSection
            period={period}
            accountId={accountId}
            currency={currency}
          />

          {/* Footer note */}
          <p className="flex flex-wrap items-start gap-2 text-xs text-muted-foreground">
            <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t("currencyNote", { currency })}</span>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => navigate("/settings")}
            >
              {t("currencyNoteLink")}
            </button>
          </p>
        </div>
      )}
      <MonthlyReportDialog open={reportOpen} onOpenChange={setReportOpen} accountId={effectiveAccount} />
    </div>
  );
}
