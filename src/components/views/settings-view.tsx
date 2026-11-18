"use client";

import Link from "next/link";
import * as React from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Accessibility, Check, ChevronRight, Clock, Compass, EyeOff, History, Keyboard, LayoutDashboard, LayoutTemplate, Link2, ListPlus, Monitor, Moon, Palette, Plug, Send, ShieldCheck, Sun, Trash2, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useTour } from "@/components/tour/guided-tour";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { COMMON_CURRENCIES } from "@/lib/trading/types";
import { COMMON_TIMEZONES } from "@/lib/time/zones";
import { cn } from "@/lib/utils";
import { MarketSessionsSettingsCard } from "@/components/tools/market-sessions-settings";

const THEME_OPTIONS = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Monitor },
] as const;

/** Common IANA timezones - the current profile tz is always offered. */
const TIMEZONES = COMMON_TIMEZONES;

/** Profile editor - PATCH /api/profile, then refresh the global session. */
function ProfileEditorCard() {
  const { session, setSession } = useSession();
  const t = useTranslations("settings");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [currency, setCurrency] = React.useState("USD");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!session) return;
    setName(session.profile.displayName);
    setTimezone(session.profile.timezone);
    setCurrency(session.profile.baseCurrency);
  }, [session]);

  if (!session) return null;
  const dirty =
    name.trim() !== session.profile.displayName ||
    timezone !== session.profile.timezone ||
    currency !== session.profile.baseCurrency;

  const tzOptions = TIMEZONES.includes(timezone)
    ? TIMEZONES
    : [timezone, ...TIMEZONES];

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await apiFetch<{
        user: { id: string; email: string };
        profile: typeof session.profile;
      }>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: name.trim(),
          timezone,
          baseCurrency: currency,
        }),
      });
      setSession(result);
      toast({ title: t("profileSaved") });
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
        <CardTitle className="text-base">{t("profile")}</CardTitle>
        <CardDescription>{t("profileDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="set-name">{t("displayName")}</Label>
            <Input
              id="set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-email">{t("email")}</Label>
            <Input
              id="set-email"
              value={session.user.email}
              disabled
              aria-describedby="set-email-hint"
            />
            <p id="set-email-hint" className="text-[11px] text-muted-foreground">
              {t("emailHint")}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="set-tz">{t("timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="set-tz">
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
            <p className="text-[11px] text-muted-foreground">{t("timezoneHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-currency">{t("baseCurrency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="set-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => void onSave()}
            disabled={saving || !dirty || name.trim() === ""}
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Profile editor + working theme preferences + shortcuts. */
export function SettingsView() {
  const { session } = useSession();
  const { theme, setTheme } = useTheme();
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const tTour = useTranslations("tour");
  const { start: startTour } = useTour();
  const { toast } = useToast();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!session) return null;
  const { profile } = session;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ProfileEditorCard />

      <MarketSessionsSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("appearance")}</CardTitle>
          <CardDescription>{t("appearanceDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-label={t("themeAria")}
          >
            {THEME_OPTIONS.map((option) => {
              const active = mounted && theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
                    active
                      ? "border-emerald-500/60 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <option.icon className="h-4 w-4" aria-hidden="true" />
                  {t(option.labelKey)}
                  {active && (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("defaultAccount")}</CardTitle>
          <CardDescription>{t("defaultAccountDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("mainAccount")}</p>
              <p className="text-xs text-muted-foreground">
                {t("mainAccountDetail", { currency: profile.baseCurrency })}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/accounts">{t("manageAccounts")}</Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("accountsNote")}
          </p>
        </CardContent>
      </Card>

      <Link
        href="/settings/account"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("accountLink")}</p>
            <p className="text-xs text-muted-foreground">{t("accountLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/appearance"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Palette className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("appearanceLink")}</p>
            <p className="text-xs text-muted-foreground">{t("appearanceLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/dashboards"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("dashboardsLink")}</p>
            <p className="text-xs text-muted-foreground">{t("dashboardsLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/templates"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <LayoutTemplate className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("templates")}</p>
            <p className="text-xs text-muted-foreground">{tNav("templatesDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/broker-sync"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Plug className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("brokerSync")}</p>
            <p className="text-xs text-muted-foreground">{tNav("brokerSyncDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/integrations"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Send className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("integrations")}</p>
            <p className="text-xs text-muted-foreground">{tNav("integrationsDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/sharing"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("sharing")}</p>
            <p className="text-xs text-muted-foreground">{tNav("sharingDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/mentors"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("mentors")}</p>
            <p className="text-xs text-muted-foreground">{tNav("mentorsDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/privacy"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <EyeOff className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("privacy")}</p>
            <p className="text-xs text-muted-foreground">{tNav("privacyDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/accessibility"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Accessibility className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("accessibility")}</p>
            <p className="text-xs text-muted-foreground">{tNav("accessibilityDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/time"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("time")}</p>
            <p className="text-xs text-muted-foreground">{tNav("timeDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/custom-fields"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <ListPlus className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("customFieldsLink")}</p>
            <p className="text-xs text-muted-foreground">{t("customFieldsLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/settings/shortcuts"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Keyboard className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("shortcutsLink")}</p>
            <p className="text-xs text-muted-foreground">{t("shortcutsLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/history"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("historyLink")}</p>
            <p className="text-xs text-muted-foreground">{t("historyLinkDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <Link
        href="/trash"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Trash2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tNav("trash")}</p>
            <p className="text-xs text-muted-foreground">{tNav("trashDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      <button
        type="button"
        onClick={startTour}
        className="flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <Compass className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{tTour("restart")}</p>
            <p className="text-xs text-muted-foreground">{tTour("restartDesc")}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}
