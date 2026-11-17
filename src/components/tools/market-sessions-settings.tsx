/**
 * v2.5 Module 5 (d) - market session settings (in the settings page).
 *
 * Edits the MarketSessionSetting rows: DISPLAY sessions (IANA clock) and
 * DETECTION ranges (used by detectSession, legacy UTC ranges by default).
 * Stored in the database; the "reset" button deletes the stored rows and
 * restores the code defaults.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  mergeSessionSettings,
} from "@/lib/tools/market-hours";
import {
  isToolsTablesMissing,
  useCreateSessionSetting,
  useResetSessionSettings,
  useSessionSettings,
  useUpdateSessionSetting,
} from "@/hooks/use-tools";
import type { MarketSessionSettingEntry } from "@/lib/tools/types";
import { ToolsUnavailable } from "./shared";

const IANA_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function MarketSessionsSettingsCard() {
  const t = useTranslations("tools");
  const settingsQuery = useSessionSettings();
  const storedRows = settingsQuery.data ?? [];
  const createSetting = useCreateSessionSetting();
  const updateSetting = useUpdateSessionSetting();
  const resetSettings = useResetSessionSettings();
  const settings = React.useMemo(
    () => mergeSessionSettings(storedRows),
    [storedRows]
  );

  const update = (id: string, patch: Partial<MarketSessionSettingEntry>) => {
    const current = settings.find((s) => s.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    if (id.startsWith("default-")) {
      // Built-in row with no stored row yet: create it (matched by kind+name).
      createSetting.mutate({
        name: next.name,
        kind: next.kind,
        timezone: next.timezone,
        openTime: next.openTime,
        closeTime: next.closeTime,
        activeDays: next.activeDays,
        enabled: next.enabled,
        sortOrder: next.sortOrder,
      });
    } else {
      updateSetting.mutate({ id, patch });
    }
  };

  const display = settings.filter((s) => s.kind === "DISPLAY");
  const detection = settings.filter((s) => s.kind === "DETECTION");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("marketSessionsSettingsTitle")}</CardTitle>
        <CardDescription>{t("marketSessionsSettingsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isToolsTablesMissing(settingsQuery.error) && <ToolsUnavailable />}
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("marketSessionsDisplayTitle")}</p>
          {display.map((s) => (
            <div key={s.id} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_180px_110px_110px_auto]">
              <div className="space-y-1">
                <Label>{s.name}</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={s.enabled}
                    onCheckedChange={(v) => update(s.id, { enabled: v })} />
                  <span className="text-xs text-muted-foreground">
                    {s.enabled ? t("enabled") : t("disabled")}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`ms-tz-${s.id}`}>{t("marketSessionsTimezone")}</Label>
                <Select value={s.timezone} onValueChange={(v) => update(s.id, { timezone: v })}>
                  <SelectTrigger id={`ms-tz-${s.id}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IANA_ZONES.map((z) => (
                      <SelectItem key={z} value={z}>{z}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`ms-open-${s.id}`}>{t("marketSessionsOpen")}</Label>
                <Input id={`ms-open-${s.id}`} type="time" value={s.openTime}
                  onChange={(e) => update(s.id, { openTime: e.target.value })} className="tabular-nums" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`ms-close-${s.id}`}>{t("marketSessionsClose")}</Label>
                <Input id={`ms-close-${s.id}`} type="time" value={s.closeTime}
                  onChange={(e) => update(s.id, { closeTime: e.target.value })} className="tabular-nums" />
              </div>
              <div className="flex flex-wrap gap-1 pb-1">
                {WEEKDAYS.map((d) => (
                  <button key={d} type="button"
                    aria-pressed={s.activeDays.includes(d)}
                    onClick={() =>
                      update(s.id, {
                        activeDays: s.activeDays.includes(d)
                          ? s.activeDays.filter((x) => x !== d)
                          : [...s.activeDays, d].sort((a, b) => a - b),
                      })
                    }
                    className={`h-7 w-7 rounded-md border text-xs tabular-nums transition-colors ${
                      s.activeDays.includes(d)
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}>
                    {t(`weekdayShort_${d}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">{t("marketSessionsDetectionTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("marketSessionsDetectionHint")}</p>
          {detection.map((s) => (
            <div key={s.id} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
              <div className="space-y-1">
                <Label>{s.name}</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={s.enabled}
                    onCheckedChange={(v) => update(s.id, { enabled: v })} />
                  <span className="text-xs text-muted-foreground">
                    {s.enabled ? t("enabled") : t("disabled")}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`msd-open-${s.id}`}>{t("marketSessionsOpen")}</Label>
                <Input id={`msd-open-${s.id}`} type="time" value={s.openTime === "24:00" ? "23:59" : s.openTime}
                  onChange={(e) => update(s.id, { openTime: e.target.value })} className="tabular-nums" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`msd-close-${s.id}`}>{t("marketSessionsClose")}</Label>
                <Input id={`msd-close-${s.id}`} type="time" value={s.closeTime === "24:00" ? "23:59" : s.closeTime}
                  onChange={(e) => update(s.id, { closeTime: e.target.value })} className="tabular-nums" />
              </div>
              <span className="pb-2 text-xs text-muted-foreground">UTC</span>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={() => resetSettings.mutate()}>
          {t("marketSessionsReset")}
        </Button>
      </CardContent>
    </Card>
  );
}
