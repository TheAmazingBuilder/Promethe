/**
 * v2.5 Module 5 (d) - market-hours clock.
 *
 * Sessions with IANA zones (DST via Intl), open/closed state, countdowns
 * to the next open/close, overlap indicator and a week-end banner.
 * Sessions are editable in the settings (MarketSessionSetting).
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  displaySessions,
  formatCountdown,
  isMarketWeekend,
  mergeSessionSettings,
  openSessionNames,
  sessionStatus,
} from "@/lib/tools/market-hours";
import { isToolsTablesMissing, useSessionSettings } from "@/hooks/use-tools";
import { ToolsUnavailable } from "./shared";

export function MarketHoursClock() {
  const t = useTranslations("tools");
  const sessionsQuery = useSessionSettings("DISPLAY");
  const overrides = sessionsQuery.data ?? [];
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const settings = React.useMemo(() => mergeSessionSettings(overrides), [overrides]);
  const statuses = React.useMemo(
    () => displaySessions(settings).map((s) => sessionStatus(s, now)),
    [settings, now]
  );
  const openNames = openSessionNames(statuses);
  const weekend = isMarketWeekend(statuses);

  return (
    <div className="space-y-4">
      {isToolsTablesMissing(sessionsQuery.error) && <ToolsUnavailable />}
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {t("marketHoursNow", {
            time: now.toLocaleTimeString(),
          })}
        </p>
        {openNames.length > 0 ? (
          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
            {t("marketHoursOpen", { sessions: openNames.join(" + ") })}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("marketHoursClosed")}</Badge>
        )}
        {openNames.length >= 2 && (
          <Badge variant="outline">{t("marketHoursOverlap")}</Badge>
        )}
      </div>

      {weekend && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          {t("marketHoursWeekend")}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {statuses.map((s) => (
          <div key={s.setting.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{s.setting.name}</p>
              <Badge variant={s.open ? "default" : "secondary"}
                className={s.open ? "bg-emerald-600 hover:bg-emerald-600" : undefined}>
                {s.open ? t("marketHoursOpenShort") : t("marketHoursClosedShort")}
              </Badge>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("marketHoursLocalTime")}</dt>
                <dd className="tabular-nums">{s.localTime} <span className="text-muted-foreground">({s.setting.timezone})</span></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("marketHoursHours")}</dt>
                <dd className="tabular-nums">{s.setting.openTime} - {s.setting.closeTime}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {s.nextChangeLabel === "opens" ? t("marketHoursOpensIn") : t("marketHoursClosesIn")}
                </dt>
                <dd className="font-semibold tabular-nums">{formatCountdown(s.nextChangeMs)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t("marketHoursNote")}</p>
    </div>
  );
}
