"use client";

/** custom-metric widget — name, big formatted value, sample size, low-sample warning. */
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toD } from "@/lib/trading/dec";
import { fmtNum, fmtPct } from "@/lib/format";
import { asCustomMetricData } from "./types";

function formatByFormat(value: string, format: string): string {
  const d = toD(value);
  if (!d.isFinite()) return "—";
  switch (format) {
    case "CURRENCY":
      return fmtNum(value);
    case "PERCENT":
      return fmtPct(value);
    case "R":
      return `${fmtNum(value)} R`;
    case "PIPS":
      return `${fmtNum(value)} pips`;
    case "DURATION": {
      const minutes = Math.max(0, Math.round(d.toNumber()));
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h > 0 ? `${h} h ${m} min` : `${m} min`;
    }
    default:
      return fmtNum(value);
  }
}

export function CustomMetricWidget({ data }: { data: unknown }) {
  const t = useTranslations("dashboards");
  const metric = asCustomMetricData(data);

  if (!metric) {
    return <p className="text-sm text-muted-foreground">{t("metricMissing")}</p>;
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <p className="truncate text-xs font-medium text-muted-foreground">
        {metric.name}
      </p>
      <p className="text-2xl font-bold tabular-nums">
        {metric.value != null
          ? formatByFormat(metric.value, metric.format)
          : "—"}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("metricSample", { count: metric.sampleSize })}
      </p>
      {metric.lowSample ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t("metricLowSample")}
        </p>
      ) : null}
    </div>
  );
}
