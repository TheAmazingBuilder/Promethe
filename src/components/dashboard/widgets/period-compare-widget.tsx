"use client";

/**
 * period-compare widget — this period vs the previous one (delta + pct).
 * The compare block only exists when the widget's period override has
 * compareToPrevious enabled — otherwise a setup hint is shown.
 */
import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toD } from "@/lib/trading/dec";
import {
  fmtNum,
  pnlClass,
} from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { Money } from "@/components/privacy/money";
import { periodCompareConfigSchema } from "@/lib/dashboard/registry";
import type { KpiBlock, KpiWidgetData } from "./types";
import { asKpiData } from "./types";

type CompareMetric = "netPnl" | "winRate" | "tradeCount" | "profitFactor";

function parseConfig(config: unknown): CompareMetric {
  const parsed = periodCompareConfigSchema.safeParse(config ?? {});
  return parsed.success
    ? (parsed.data.metric as CompareMetric)
    : "netPnl";
}

function metricValue(
  data: KpiBlock,
  metric: CompareMetric
): { raw: string | null; kind: "money" | "pct" | "count" } {
  switch (metric) {
    case "winRate":
      return { raw: data.stats.winRate, kind: "pct" };
    case "tradeCount":
      return { raw: String(data.stats.tradeCount), kind: "count" };
    case "profitFactor":
      return { raw: data.stats.profitFactor, kind: "count" };
    default:
      return { raw: data.stats.netPnl, kind: "money" };
  }
}

export function PeriodCompareWidget({
  data,
  config,
  currency,
}: {
  data: unknown;
  config: unknown;
  currency: string;
}) {
  const t = useTranslations("dashboards");
  const fmt = useFormat();
  const metric = parseConfig(config);
  const kpiData = asKpiData(data);

  if (!kpiData) {
    return <p className="text-sm text-muted-foreground">{t("kpiNoDataFallback")}</p>;
  }

  const current = metricValue(kpiData, metric);
  const label = t(`kpi.${metric === "tradeCount" ? "tradeCount" : metric}`);

  const formatMetric = (raw: string | null): React.ReactNode => {
    if (raw == null || !toD(raw).isFinite()) return "—";
    if (current.kind === "money")
      return <Money signed value={raw} currency={currency} />;
    if (current.kind === "pct") return fmt.pct(raw);
    return fmtNum(raw, metric === "tradeCount" ? 0 : 2);
  };

  const compare = kpiData.compare;
  if (compare == null) {
    return (
      <div className="space-y-1">
        <p className="text-xl font-bold tabular-nums sm:text-2xl">
          {formatMetric(current.raw)}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("compareNeedsPrevious")}
        </p>
      </div>
    );
  }

  const previous = metricValue(compare, metric);
  const cur = current.raw != null && toD(current.raw).isFinite() ? toD(current.raw) : null;
  const prev = previous.raw != null && toD(previous.raw).isFinite() ? toD(previous.raw) : null;
  const diff = cur != null && prev != null ? cur.minus(prev) : null;
  const pct =
    diff != null && prev != null && !prev.isZero()
      ? diff.div(prev.abs()).times(100)
      : null;
  const up = diff != null && diff.gt(0);
  const tone = pnlClass(diff);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums sm:text-2xl">
        {formatMetric(current.raw)}
      </p>
      {diff != null ? (
        <p className={`flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums ${tone}`}>
          {up ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : diff.isZero() ? (
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          )}
          <span>
            {current.kind === "money" ? (
              <Money signed value={diff.toString()} currency={currency} />
            ) : current.kind === "pct" ? (
              `${fmtNum(diff.toString())} pp`
            ) : (
              fmtNum(diff.toString(), 0)
            )}
          </span>
          {pct != null ? (
            <span className="text-muted-foreground">
              ({fmtNum(pct.toString(), 1)} %)
            </span>
          ) : null}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("comparePrevious")}: {formatMetric(previous.raw)}
      </p>
    </div>
  );
}
