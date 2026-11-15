"use client";

/** win-loss widget — donut chart with center total + legend with counts. */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { fmtNum } from "@/lib/format";
import { asWinLossData } from "./types";

interface WinLossDatum {
  name: string;
  value: number;
  color: string;
}

function WinLossTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: WinLossDatum }>;
}) {
  if (!active) return null;
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{point.name}</p>
      <p className="mt-1 tabular-nums">{point.value}</p>
    </div>
  );
}

export function WinLossWidget({
  data,
  heightPx,
}: {
  data: unknown;
  heightPx: number;
}) {
  const t = useTranslations("dashboards");
  const { reducedMotionActive } = useA11yPrefs();

  const wl = asWinLossData(data);
  const rows = React.useMemo<WinLossDatum[]>(() => {
    if (!wl) return [];
    return [
      { name: t("winLossWins"), value: wl.wins, color: "var(--gain)" },
      { name: t("winLossLosses"), value: wl.losses, color: "var(--loss)" },
      { name: t("winLossBreakevens"), value: wl.breakevens, color: "var(--neutral)" },
    ].filter((r) => r.value > 0);
  }, [t, wl]);

  const total = wl ? wl.wins + wl.losses + wl.breakevens : 0;
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>;
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative w-full" style={{ height: Math.max(120, heightPx - 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={!reducedMotionActive}
            >
              {rows.map((row) => (
                <Cell key={row.name} fill={row.color} fillOpacity={0.9} />
              ))}
            </Pie>
            <Tooltip content={<WinLossTooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xl font-bold tabular-nums">{fmtNum(total, 0)}</p>
          <p className="text-[10px] text-muted-foreground">{t("winLossTotal")}</p>
        </div>
      </div>
      <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{row.name}</span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
