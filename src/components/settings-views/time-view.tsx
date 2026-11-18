"use client";

/**
 * TimeView (v2.5 Module 8, §3.4) — /settings/time.
 *
 * Main timezone (profile, editable here), extra timezones (max 3), clock
 * format, trading-day definition (mode + custom rollover) and the broker
 * server time of each account (read-only — configured in /accounts).
 * Every change applies instantly through the TimeProvider (partial PUT to
 * /api/display-preferences, except the main timezone which PATCHes the
 * profile like the settings page does).
 */
import Link from "next/link";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Clock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/components/app/session-context";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { COMMON_TIMEZONES, isValidTimezone } from "@/lib/time/zones";
import { rolloverLabel, type TradingDayRolloverMode } from "@/lib/time/trading-day";
import { useTimePrefs } from "@/components/time/time-provider";
import {
  BrokerServerClocks,
  MultiZoneClock,
} from "@/components/time/multi-zone-clock";

const MODE_OPTIONS: Array<{
  value: TradingDayRolloverMode;
  labelKey: string;
  descKey: string;
}> = [
  { value: "MIDNIGHT_LOCAL", labelKey: "modeMidnight", descKey: "modeMidnightDesc" },
  { value: "NEW_YORK_CLOSE", labelKey: "modeNyClose", descKey: "modeNyCloseDesc" },
  { value: "CUSTOM", labelKey: "modeCustom", descKey: "modeCustomDesc" },
];

const FORMAT_OPTIONS = [
  { value: "LOCALE", labelKey: "formatLocale" },
  { value: "24H", labelKey: "format24" },
  { value: "12H", labelKey: "format12" },
] as const;

function MainTimezoneCard() {
  const { session, setSession } = useSession();
  const t = useTranslations("time");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const [timezone, setTimezone] = React.useState("UTC");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (session) setTimezone(session.profile.timezone);
  }, [session]);

  if (!session) return null;
  const dirty = timezone !== session.profile.timezone;
  const tzOptions = COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await apiFetch<{
        user: { id: string; email: string };
        profile: typeof session.profile;
      }>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ timezone }),
      });
      setSession(result);
      toast({ title: t("mainSaved") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mainTitle")}</CardTitle>
        <CardDescription>{t("mainDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="time-main-tz">{t("mainLabel")}</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="time-main-tz">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tzOptions.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void onSave()} disabled={saving || !dirty}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ExtraTimezonesCard() {
  const t = useTranslations("time");
  const { toast } = useToast();
  const { preferences, set } = useTimePrefs();
  const [label, setLabel] = React.useState("");
  const [zone, setZone] = React.useState("America/New_York");
  const [saving, setSaving] = React.useState(false);

  const extras = preferences.extraTimezones;
  const full = extras.length >= 3;

  const save = async (next: typeof extras) => {
    setSaving(true);
    try {
      await set({ extraTimezones: next });
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onAdd = () => {
    const trimmed = label.trim();
    if (trimmed === "" || !isValidTimezone(zone) || full) return;
    void save([...extras, { label: trimmed, ianaTimezone: zone, kind: "USER" }]);
    setLabel("");
  };

  const onRemove = (index: number) => {
    void save(extras.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("extraTitle")}</CardTitle>
        <CardDescription>{t("extraDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {extras.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("extraEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {extras.map((z, i) => (
              <li
                key={`${z.label}-${z.ianaTimezone}`}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{z.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {z.ianaTimezone}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("extraRemove", { label: z.label })}
                  onClick={() => onRemove(i)}
                  disabled={saving}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="time-extra-label">{t("extraLabel")}</Label>
            <Input
              id="time-extra-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("extraLabelPlaceholder")}
              maxLength={24}
              disabled={full || saving}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="time-extra-zone">{t("extraZone")}</Label>
            <Select value={zone} onValueChange={setZone} disabled={full || saving}>
              <SelectTrigger id="time-extra-zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onAdd} disabled={full || saving || label.trim() === ""}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("extraAdd")}
          </Button>
        </div>
        {full && (
          <p className="text-xs text-muted-foreground" role="status">
            {t("extraFull")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TradingDayCard() {
  const t = useTranslations("time");
  const { toast } = useToast();
  const { preferences, set } = useTimePrefs();
  const tradingDay = preferences.tradingDay;

  const save = async (next: typeof tradingDay) => {
    try {
      await set({ tradingDay: next });
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" });
    }
  };

  const modeDesc =
    MODE_OPTIONS.find((o) => o.value === tradingDay.mode)?.descKey ??
    "modeMidnightDesc";
  const rolloverTzOptions =
    tradingDay.rolloverTimezone != null &&
    !COMMON_TIMEZONES.includes(tradingDay.rolloverTimezone)
      ? [tradingDay.rolloverTimezone, ...COMMON_TIMEZONES]
      : COMMON_TIMEZONES;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("tradingDayTitle")}</CardTitle>
        <CardDescription>{t("tradingDayDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="time-trading-mode">{t("tradingDayMode")}</Label>
          <Select
            value={tradingDay.mode}
            onValueChange={(v) =>
              void save({ ...tradingDay, mode: v as TradingDayRolloverMode })
            }
          >
            <SelectTrigger id="time-trading-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t(modeDesc)}</p>
        </div>
        {tradingDay.mode === "CUSTOM" && (
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="time-rollover-time">{t("rolloverTime")}</Label>
              <Input
                id="time-rollover-time"
                type="time"
                className="font-mono tabular-nums"
                value={tradingDay.rolloverTime ?? "17:00"}
                onChange={(e) =>
                  void save({
                    ...tradingDay,
                    rolloverTime: e.target.value === "" ? null : e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time-rollover-tz">{t("rolloverZone")}</Label>
              <Select
                value={tradingDay.rolloverTimezone ?? "America/New_York"}
                onValueChange={(v) =>
                  void save({ ...tradingDay, rolloverTimezone: v })
                }
              >
                <SelectTrigger id="time-rollover-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rolloverTzOptions.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground tabular-nums" role="status">
          {t("rolloverNow", { rollover: rolloverLabel(tradingDay) })}
        </p>
      </CardContent>
    </Card>
  );
}

export function TimeView() {
  const t = useTranslations("time");
  const { toast } = useToast();
  const { preferences, set } = useTimePrefs();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" aria-hidden="true" />
            {t("clocksTitle")}
          </CardTitle>
          <CardDescription>{t("clocksDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <MultiZoneClock variant="full" />
        </CardContent>
      </Card>

      <MainTimezoneCard />

      <ExtraTimezonesCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("formatTitle")}</CardTitle>
          <CardDescription>{t("formatDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="time-format">{t("formatLabel")}</Label>
            <Select
              value={preferences.timeFormat}
              onValueChange={(v) => {
                void set({
                  timeFormat: v as (typeof FORMAT_OPTIONS)[number]["value"],
                }).catch(() =>
                  toast({
                    title: t("saveFailed"),
                    variant: "destructive",
                  })
                );
              }}
            >
              <SelectTrigger id="time-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <TradingDayCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("brokerTitle")}</CardTitle>
          <CardDescription>{t("brokerDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BrokerServerClocks />
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounts">{t("brokerManage")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
