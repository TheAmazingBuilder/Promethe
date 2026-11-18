"use client";

/**
 * PrivacyView (v2.5 Module 8, §3.1/§3.2) — /settings/privacy.
 *
 * Every control applies INSTANTLY (privacy store) and persists per device +
 * to the server row (debounced) — no save bar, unlike the appearance view.
 * Includes the presenting preset (temporary maximal privacy, reversible) and
 * the documented-limits card: privacy mode is a display convenience, not a
 * security control; screen sharing cannot be detected.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  MonitorPlay,
  ScanEye,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { usePrivacyPreferences } from "@/components/privacy/privacy-provider";
import type { PrivacyMode, PrivacyScope } from "@/lib/privacy/types";
import { cn } from "@/lib/utils";

const MODES: Array<{
  value: PrivacyMode;
  labelKey: string;
  descKey: string;
  icon: typeof Eye;
}> = [
  { value: "OFF", labelKey: "modeOff", descKey: "modeOffDesc", icon: Eye },
  { value: "HIDE", labelKey: "modeHide", descKey: "modeHideDesc", icon: EyeOff },
  { value: "BLUR", labelKey: "modeBlur", descKey: "modeBlurDesc", icon: ScanEye },
];

const SCOPE_FLAGS: Array<{
  key: keyof PrivacyScope;
  labelKey: string;
  defaultHint?: boolean;
}> = [
  { key: "hideCurrencyAmounts", labelKey: "scopeCurrencyAmounts" },
  { key: "hideBalances", labelKey: "scopeBalances" },
  { key: "hideLots", labelKey: "scopeLots" },
  { key: "hideAccountNames", labelKey: "scopeAccountNames" },
  { key: "hideBrokerInfo", labelKey: "scopeBrokerInfo" },
  { key: "hidePercentages", labelKey: "scopePercentages", defaultHint: true },
  { key: "hideRAndPips", labelKey: "scopeRAndPips", defaultHint: true },
];

const INACTIVITY_OPTIONS = [30, 60, 120, 300, 600] as const;

export function PrivacyView() {
  const t = useTranslations("privacy");
  const tCommon = useTranslations("common");
  const {
    preferences,
    setMode,
    setScope,
    setAuto,
    setShortcut,
    setBlurScreenshots,
    setRevealOnHover,
    hideAmountsInNotifications,
    setHideAmountsInNotifications,
    startPresenting,
    stopPresenting,
    isPresenting,
    autoActive,
    synced,
  } = usePrivacyPreferences();

  const active = preferences.mode !== "OFF";
  const [shortcutDraft, setShortcutDraft] = React.useState(preferences.shortcut);

  React.useEffect(() => {
    setShortcutDraft(preferences.shortcut);
  }, [preferences.shortcut]);

  const commitShortcut = () => {
    const normalized = shortcutDraft
      .trim()
      .toLowerCase()
      .replace(/\s*\+\s*/g, "+")
      .replace(/\s+/g, "+");
    if (normalized && normalized !== preferences.shortcut) {
      setShortcut(normalized);
    } else if (!normalized) {
      setShortcutDraft(preferences.shortcut);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        descriptionClassName="max-w-2xl"
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isPresenting && (
            <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <MonitorPlay className="h-3 w-3" aria-hidden="true" />
              {t("presentingPreset")}
            </Badge>
          )}
          {autoActive && (
            <Badge variant="secondary">{t("autoActiveBadge")}</Badge>
          )}
          <Badge variant={synced ? "secondary" : "outline"}>
            {synced ? t("saved") : t("saveFailed")}
          </Badge>
          </div>
        }
      />

      {/* ── Mode ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("mode")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("mode")}>
            {MODES.map(({ value, labelKey, descKey, icon: Icon }) => {
              const selected = preferences.mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(value)}
                  className={cn(
                    "flex min-h-24 flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t(labelKey)}
                    {selected && (
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(descKey)}</span>
                </button>
              );
            })}
          </div>

          <Separator className="my-4" />

          {/* Presenting preset */}
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MonitorPlay className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{t("presentingPreset")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("presentingDesc")}
                </p>
              </div>
            </div>
            {isPresenting ? (
              <Button variant="secondary" size="sm" onClick={stopPresenting}>
                {t("stopPresenting")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={startPresenting}>
                <MonitorPlay className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("startPresenting")}
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("screenshareNote")}</p>
        </CardContent>
      </Card>

      {/* ── Scope ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("scope")}</CardTitle>
          <CardDescription>{t("scopeDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SCOPE_FLAGS.map(({ key, labelKey, defaultHint }) => (
            <Label
              key={key}
              htmlFor={`scope-${key}`}
              className="flex min-w-0 items-start gap-3 font-normal"
            >
              <Checkbox
                id={`scope-${key}`}
                checked={preferences.scope[key]}
                disabled={!active}
                onCheckedChange={(v) => setScope({ [key]: v === true })}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 text-sm leading-snug">
                {t(labelKey)}
                {defaultHint && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({tCommon("optional")})
                  </span>
                )}
              </span>
            </Label>
          ))}
        </CardContent>
      </Card>

      {/* ── Auto-privacy ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("autoPrivacy")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-blur" className="text-sm font-medium">
                {t("autoWindowBlur")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("autoWindowBlurDesc")}
              </p>
            </div>
            <Switch
              id="auto-blur"
              checked={preferences.auto.onWindowBlur}
              onCheckedChange={(v) => setAuto({ onWindowBlur: v })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-inactivity" className="text-sm font-medium">
                {t("autoInactivity")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("autoInactivityDesc")}
              </p>
            </div>
            <Select
              value={String(preferences.auto.onInactivitySeconds ?? "off")}
              onValueChange={(v) =>
                setAuto({ onInactivitySeconds: v === "off" ? null : Number(v) })
              }
            >
              <SelectTrigger id="auto-inactivity" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t("autoInactivityOff")}</SelectItem>
                {INACTIVITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {t("autoInactivitySeconds", { seconds: s })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── BLUR options ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("blurOptions")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="blur-screenshots" className="text-sm font-medium">
                {t("blurScreenshots")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("blurScreenshotsDesc")}
              </p>
            </div>
            <Switch
              id="blur-screenshots"
              checked={preferences.blurScreenshots}
              onCheckedChange={setBlurScreenshots}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="reveal-hover" className="text-sm font-medium">
                {t("revealOnHover")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("revealOnHoverDesc")}
              </p>
            </div>
            <Switch
              id="reveal-hover"
              checked={preferences.revealOnHover}
              onCheckedChange={setRevealOnHover}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Shortcut ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("shortcut")}</CardTitle>
          <CardDescription>{t("shortcutDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label htmlFor="privacy-shortcut" className="sr-only">
              {t("shortcut")}
            </Label>
            <Input
              id="privacy-shortcut"
              value={shortcutDraft}
              onChange={(e) => setShortcutDraft(e.target.value)}
              onBlur={commitShortcut}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitShortcut();
                }
              }}
              placeholder="shift+h"
              className="font-mono"
              aria-describedby="privacy-shortcut-hint"
            />
            <p id="privacy-shortcut-hint" className="mt-1.5 text-xs text-muted-foreground">
              {t("shortcutHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Notifications ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("notifications")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notif-amounts" className="text-sm font-medium">
                {t("hideAmountsInNotifications")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("hideAmountsInNotificationsDesc")}
              </p>
            </div>
            <Switch
              id="notif-amounts"
              checked={hideAmountsInNotifications}
              onCheckedChange={setHideAmountsInNotifications}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Documented limits ── */}
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            {t("limitsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("limitsBody")}</p>
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("screenshareNote")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("limitsSharing")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
