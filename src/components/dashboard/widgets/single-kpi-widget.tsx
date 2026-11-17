"use client";

/** single-kpi widget - one KPI card from the KPI catalog. */
import { useTranslations } from "next-intl";
import { singleKpiConfigSchema } from "@/lib/dashboard/registry";
import type { KpiKey } from "@/lib/dashboard/types";
import { asKpiData } from "./types";
import { KpiCards } from "./kpi-strip-widget";

function parseConfig(config: unknown): { kpi: KpiKey; showDelta: boolean } {
  const parsed = singleKpiConfigSchema.safeParse(config ?? {});
  if (parsed.success) {
    return parsed.data as { kpi: KpiKey; showDelta: boolean };
  }
  return { kpi: "netPnl", showDelta: false };
}

export function SingleKpiWidget({
  data,
  config,
  currency,
}: {
  data: unknown;
  config: unknown;
  currency: string;
}) {
  const t = useTranslations("dashboards");
  const parsed = parseConfig(config);
  const kpiData = asKpiData(data);
  return (
    <div className="flex h-full items-stretch">
      <div className="grid w-full grid-cols-1">
        <KpiCards
          data={kpiData}
          kpis={[parsed.kpi]}
          showDelta={parsed.showDelta}
          currency={currency}
        />
      </div>
      <span className="sr-only">{t("kpiAria", { kpi: t(`kpi.${parsed.kpi}`) })}</span>
    </div>
  );
}
