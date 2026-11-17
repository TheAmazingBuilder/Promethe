"use client";

/**
 * kpi-strip / single-kpi widgets — the KPI card grid ported from the old
 * dashboard view. Labels come from the KPI_KEYS catalog (dashboards.kpi.*),
 * each key formats its value (money / percent / R / plain / pips / duration /
 * streak). Optional delta vs the comparison period (showDelta).
 */
import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toD } from "@/lib/trading/dec";
import { Money } from "@/components/privacy/money";
import {
  fmtNum,
  fmtSigned,
  pnlClass,
} from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { useAnimatedDecimal } from "@/hooks/use-count-up";
import { cn } from "@/lib/utils";
import type { KpiKey } from "@/lib/dashboard/types";
import { kpiStripConfigSchema } from "@/lib/dashboard/registry";
import type { KpiBlock, KpiWidgetData } from "./types";
import { asKpiData } from "./types";

const EMERALD = "text-gain";
const ROSE = "text-loss";

/** One KPI card - ported from the old dashboard view. */
export function KpiCard({
  label,
  value,
  valueClassName,
  sub,
  sparkline,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  sub?: React.ReactNode;
  sparkline?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 transition-colors hover:border-accent-foreground/25 hover:bg-accent/40 sm:p-4">
      <p className="truncate text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p
        className={`tabular-nums ${
          compact ? "text-lg font-semibold" : "text-xl font-bold sm:text-2xl"
        } ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      {sparkline}
      {sub != null ? (
        <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/** Tiny inline SVG sparkline - cumulative P&L path of the period. Green when
    the period ends above where it started, red otherwise. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 24;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${(pad + (i * (w - pad * 2)) / (values.length - 1)).toFixed(1)},${(
          h -
          pad -
          ((v - min) / span) * (h - pad * 2)
        ).toFixed(1)}`
    )
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-full", up ? "text-gain" : "text-loss")}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Formats whose value is money - the only ones a P&L sparkline describes. */
const SPARKLINE_FORMATS = new Set<KpiFormat>(["money", "moneySigned"]);

/** Raw decimal string of one KPI from a KPI block, or null. */
function kpiRaw(block: KpiBlock | null, key: KpiKey): string | null {
  if (!block) return null;
  const { stats, advanced, extras } = block;
  switch (key) {
    case "netPnl":
      return stats.netPnl;
    case "grossWin":
      return stats.grossWin;
    case "grossLoss":
      return stats.grossLoss;
    case "winRate":
      return stats.winRate;
    case "profitFactor":
      return stats.profitFactor;
    case "expectancyR":
      return stats.expectancyR;
    case "expectancyCurrency":
      // Not part of the server payload — derived client-side (netPnl / N).
      return stats.tradeCount > 0
        ? toD(stats.netPnl).div(stats.tradeCount).toString()
        : null;
    case "avgR":
      return stats.avgR;
    case "totalR":
      return stats.totalR;
    case "avgWin":
      return stats.avgWin;
    case "avgLoss":
      return stats.avgLoss;
    case "payoffRatio":
      return advanced.payoffRatio;
    case "tradeCount":
      return String(stats.tradeCount);
    case "maxDrawdown":
      return stats.maxDrawdown;
    case "currentDrawdown":
      return extras.currentDrawdown;
    case "currentStreak":
      return String(stats.currentStreak);
    case "bestTrade":
      return extras.bestTrade;
    case "worstTrade":
      return extras.worstTrade;
    case "avgDurationMin":
      return advanced.avgDurationMin != null
        ? String(advanced.avgDurationMin)
        : null;
    case "sqn":
      return advanced.sqn;
    case "totalPips":
      return extras.totalPips;
    case "totalFees":
      return advanced.totalFees;
    case "avgRiskPercent":
      return extras.avgRiskPercent;
    case "reviewedPercent":
      return extras.reviewedPercent;
    case "tradingDays":
      return String(stats.tradingDays);
    default:
      return null;
  }
}

/** Duration in minutes → "1 h 23 min" style (analytics namespace reuse). */
function useDurationLabel() {
  const t = useTranslations("analytics");
  return React.useCallback(
    (minutes: number): string => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      if (h > 0) return t("durationHm", { h, m });
      return t("durationM", { m });
    },
    [t]
  );
}

function isFiniteNumber(v: string | null): v is string {
  if (v == null) return false;
  return toD(v).isFinite();
}

/** Format groups - which formatter a KPI key uses. */
type KpiFormat =
  | "money"
  | "moneySigned"
  | "percent"
  | "r"
  | "plain"
  | "pips"
  | "duration"
  | "streak"
  | "count";

const KPI_FORMAT: Record<KpiKey, KpiFormat> = {
  netPnl: "moneySigned",
  grossWin: "money",
  grossLoss: "money",
  winRate: "percent",
  profitFactor: "plain",
  expectancyR: "r",
  expectancyCurrency: "moneySigned",
  avgR: "r",
  totalR: "r",
  avgWin: "money",
  avgLoss: "money",
  payoffRatio: "plain",
  tradeCount: "count",
  maxDrawdown: "money",
  currentDrawdown: "money",
  currentStreak: "streak",
  bestTrade: "moneySigned",
  worstTrade: "moneySigned",
  avgDurationMin: "duration",
  sqn: "plain",
  totalPips: "pips",
  totalFees: "money",
  avgRiskPercent: "percent",
  reviewedPercent: "percent",
  tradingDays: "count",
};

/** Keys where a NEGATIVE delta is actually good - tone flips. */
const LOWER_IS_BETTER = new Set<KpiKey>([
  "grossLoss",
  "avgLoss",
  "maxDrawdown",
  "currentDrawdown",
  "worstTrade",
  "totalFees",
]);

/** Display value + tone for one KPI raw string. */
function useKpiDisplay() {
  const tDash = useTranslations("dashboard");
  const durationLabel = useDurationLabel();
  const fmt = useFormat();

  return React.useCallback(
    (
      key: KpiKey,
      raw: string | null,
      currency: string
    ): { value: React.ReactNode; tone: string } => {
      const format = KPI_FORMAT[key];
      if (format !== "count" && !isFiniteNumber(raw)) {
        return { value: "-", tone: "" };
      }
      const d = raw != null ? toD(raw) : null;
      switch (format) {
        case "money":
          return {
            value: <Money value={raw} currency={currency} />,
            tone:
              key === "grossWin" || key === "avgWin"
                ? EMERALD
                : key === "grossLoss" ||
                    key === "avgLoss" ||
                    key === "currentDrawdown" ||
                    key === "maxDrawdown"
                  ? ROSE
                  : "text-muted-foreground",
          };
        case "moneySigned":
          return {
            value: <Money signed value={raw} currency={currency} />,
            tone: pnlClass(raw),
          };
        case "percent":
          return { value: fmt.pct(raw), tone: "" };
        case "r":
          return { value: `${fmtSigned(raw)} R`, tone: pnlClass(raw) };
        case "plain": {
          const n = d?.toNumber() ?? NaN;
          if (key === "profitFactor" && !Number.isFinite(n)) {
            return { value: "∞", tone: EMERALD };
          }
          return {
            value: fmtNum(raw),
            tone:
              key === "profitFactor"
                ? n >= 2
                  ? EMERALD
                  : n < 1
                    ? ROSE
                    : ""
                : "",
          };
        }
        case "count":
          return { value: fmtNum(raw ?? "0", 0), tone: "" };
        case "pips":
          return { value: `${fmtSigned(raw)} pips`, tone: pnlClass(raw) };
        case "duration":
          return { value: durationLabel(d?.toNumber() ?? 0), tone: "" };
        case "streak": {
          const n = Math.round(d?.toNumber() ?? 0);
          if (n > 0) {
            return { value: tDash("streakWin", { count: n }), tone: EMERALD };
          }
          if (n < 0) {
            return {
              value: tDash("streakLoss", { count: Math.abs(n) }),
              tone: ROSE,
            };
          }
          return { value: "-", tone: "" };
        }
        default:
          return { value: "-", tone: "" };
      }
    },
    [durationLabel, tDash, fmt]
  );
}

/** Signed delta line vs the previous period (showDelta). */
function KpiDelta({
  kpi,
  current,
  previous,
  currency,
}: {
  kpi: KpiKey;
  current: string | null;
  previous: string | null;
  currency: string;
}) {
  const t = useTranslations("dashboards");
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  const diff = toD(current).minus(toD(previous));
  if (diff.isZero()) {
    return (
      <p className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden="true" />
        {t("kpiNoChange")}
      </p>
    );
  }
  const format = KPI_FORMAT[kpi];
  let body: React.ReactNode;
  switch (format) {
    case "percent":
      body = `${fmtSigned(diff.toString())} pp`;
      break;
    case "r":
      body = `${fmtSigned(diff.toString())} R`;
      break;
    case "pips":
      body = `${fmtSigned(diff.toString())} pips`;
      break;
    case "count":
    case "streak":
      body = fmtSigned(diff.toString(), 0);
      break;
    case "duration":
      body = fmtSigned(diff.toString(), 0);
      break;
    case "plain":
      body = fmtSigned(diff.toString());
      break;
    default:
      body = <Money signed value={diff.toString()} currency={currency} />;
      break;
  }
  const up = diff.gt(0);
  const tone = pnlClass(LOWER_IS_BETTER.has(kpi) ? diff.negated() : diff);
  return (
    <p className={`flex items-center gap-1 text-xs tabular-nums ${tone}`}>
      {up ? (
        <ArrowUp className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ArrowDown className="h-3 w-3" aria-hidden="true" />
      )}
      {body}
      <span className="sr-only">{t("kpiVsPrevious")}</span>
    </p>
  );
}

/** Parsed kpi-strip config with defaults on corruption. */
export function parseKpiStripConfig(config: unknown): {
  kpis: KpiKey[];
  showDelta: boolean;
  showSparkline: boolean;
} {
  const parsed = kpiStripConfigSchema.safeParse(config ?? {});
  if (parsed.success) {
    return parsed.data as {
      kpis: KpiKey[];
      showDelta: boolean;
      showSparkline: boolean;
    };
  }
  return {
    kpis: [
      "netPnl",
      "winRate",
      "profitFactor",
      "expectancyR",
      "tradeCount",
      "maxDrawdown",
      "currentStreak",
      "tradingDays",
    ],
    showDelta: false,
    showSparkline: false,
  };
}

/** One KPI card with a count-up on its value (see useAnimatedDecimal). */
function AnimatedKpiCard({
  kpiKey,
  raw,
  block,
  compare,
  sparkline,
  showSparkline,
  showDelta,
  currency,
  compact = false,
}: {
  kpiKey: KpiKey;
  raw: string | null;
  block: KpiBlock | null;
  compare: KpiBlock | null;
  sparkline: number[] | null;
  showSparkline: boolean;
  showDelta: boolean;
  currency: string;
  compact?: boolean;
}) {
  const t = useTranslations("dashboards");
  const fmt = useFormat();
  const display = useKpiDisplay();
  const animatedRaw = useAnimatedDecimal(raw);
  const { value, tone } = display(kpiKey, animatedRaw, currency);
  const prevRaw = showDelta ? kpiRaw(compare, kpiKey) : null;
  const sub =
    showDelta && compare != null ? (
      <KpiDelta
        kpi={kpiKey}
        current={raw}
        previous={prevRaw}
        currency={currency}
      />
    ) : kpiKey === "maxDrawdown" &&
        block?.stats.maxDrawdownPercent != null ? (
      <span>{fmt.pct(block.stats.maxDrawdownPercent)}</span>
    ) : null;
  return (
    <KpiCard
      compact={compact}
      label={t(`kpi.${kpiKey}`)}
      value={value}
      valueClassName={tone}
      sub={sub}
      sparkline={
        showSparkline &&
        SPARKLINE_FORMATS.has(KPI_FORMAT[kpiKey]) &&
        sparkline != null ? (
          <Sparkline values={sparkline} />
        ) : undefined
      }
    />
  );
}

/** Shared body: renders the KPI cards of the widget payload (strip + single). */
export function KpiCards({
  data,
  kpis,
  showDelta,
  showSparkline = false,
  currency,
  compact = false,
}: {
  data: KpiWidgetData | null;
  kpis: KpiKey[];
  showDelta: boolean;
  showSparkline?: boolean;
  currency: string;
  compact?: boolean;
}) {
  const block: KpiBlock | null = data
    ? { stats: data.stats, advanced: data.advanced, extras: data.extras }
    : null;
  const compare = data?.compare ?? null;
  const sparkline =
    data?.sparkline != null
      ? data.sparkline.map((v) => Number(v)).filter((n) => Number.isFinite(n))
      : null;

  return (
    <>
      {kpis.map((key) => (
        <AnimatedKpiCard
          key={key}
          kpiKey={key}
          raw={kpiRaw(block, key)}
          block={block}
          compare={compare}
          sparkline={sparkline}
          showSparkline={showSparkline}
          showDelta={showDelta}
          currency={currency}
          compact={compact}
        />
      ))}
    </>
  );
}

export function KpiStripWidget({
  data,
  config,
  currency,
}: {
  data: unknown;
  config: unknown;
  currency: string;
}) {
  const parsed = parseKpiStripConfig(config);
  const kpiData = asKpiData(data);
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 @lg:grid-cols-3 @2xl:grid-cols-4">
      <KpiCards
        data={kpiData}
        kpis={parsed.kpis}
        showDelta={parsed.showDelta}
        showSparkline={parsed.showSparkline}
        currency={currency}
        compact={parsed.kpis.length > 4}
      />
    </div>
  );
}
