"use client";

/**
 * Profile page, /settings/profile — the design of the reference images
 * (header card, Personal / Account / Security / Notifications tabs) with
 * only real Promethe data and working actions.
 *
 * What is real here, and what is honestly left out:
 * - Personal: display name, email (read-only), timezone, base currency.
 *   Promethe stores no phone, bio, company, job title or location, so
 *   those fields are not shown.
 * - Account: status Active, plan Free (no subscription to manage),
 *   data export (real ZIP, 24 h cooldown), danger zone wired to the real
 *   deletion flow (password + DELETE, 7-day grace, cancellable).
 * - Security: change password (new real route), two-factor shown as
 *   "Not available" (no TOTP exists), active sessions from AuthSession
 *   rows with revoke. No login-notification toggle: no such channel exists.
 * - Notifications: Discord / Telegram subscription toggles, plus the
 *   browser push opt-in (PushNotificationsSection, default off). There
 *   is no email or marketing channel in Promethe, so none is rendered.
 */
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  Download,
  KeyRound,
  Mail,
  ShieldCheck,
  Trash2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSession } from "@/components/app/session-context";
import { PushNotificationsSection } from "@/components/profile/push-notifications-section";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { COMMON_CURRENCIES } from "@/lib/trading/types";
import { COMMON_TIMEZONES } from "@/lib/time/zones";
import {
  daysUntilDeletion,
  formatMemberSince,
  formatShortDate,
  initialsFromName,
} from "@/lib/profile-helpers";
import type { SessionProfile } from "@/lib/auth/types";

type TabId = "personal" | "account" | "security" | "notifications";

type EventType = "DAILY_SUMMARY" | "DRAWDOWN_ALERT" | "PROP_ALERT";

const EVENT_TYPES: EventType[] = [
  "DAILY_SUMMARY",
  "DRAWDOWN_ALERT",
  "PROP_ALERT",
];

interface ProfileResponse {
  user: { id: string; email: string; createdAt: string };
  profile: SessionProfile;
}

interface SessionRow {
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

interface EndpointDTO {
  id: string;
  type: "DISCORD_WEBHOOK" | "TELEGRAM_BOT";
  label: string;
  isEnabled: boolean;
}

interface SubscriptionDTO {
  id: string;
  endpointId: string;
  eventType: EventType;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  isEnabled: boolean;
}

interface IntegrationsOverview {
  endpoints: EndpointDTO[];
  subscriptions: SubscriptionDTO[];
}

type DeletionState = {
  status: "PENDING" | "CANCELLED" | "COMPLETED";
  requestedAt: string;
  scheduledFor: string;
} | null;

function eventLabelKey(eventType: EventType): string {
  switch (eventType) {
    case "DAILY_SUMMARY":
      return "eventDailySummary";
    case "DRAWDOWN_ALERT":
      return "eventDrawdownAlert";
    case "PROP_ALERT":
      return "eventPropAlert";
  }
}

function eventDescKey(eventType: EventType): string {
  switch (eventType) {
    case "DAILY_SUMMARY":
      return "eventDailySummaryDesc";
    case "DRAWDOWN_ALERT":
      return "eventDrawdownAlertDesc";
    case "PROP_ALERT":
      return "eventPropAlertDesc";
  }
}

/** Personal tab — the editable profile form (real fields only). */
function PersonalTab({
  nameRef,
}: {
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { session, setSession } = useSession();
  const t = useTranslations("profile");
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

  const tzOptions = COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await apiFetch<{
        user: { id: string; email: string };
        profile: typeof session.profile;
      }>("/api/v1/profile", {
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
        <CardTitle className="text-base">{t("personalTitle")}</CardTitle>
        <CardDescription>{t("personalDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">{t("displayName")}</Label>
            <Input
              ref={nameRef}
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">{t("email")}</Label>
            <Input id="profile-email" value={session.user.email} disabled />
            <p className="text-[11px] text-muted-foreground">{t("emailHint")}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-tz">{t("timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="profile-tz">
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
            <p className="text-[11px] text-muted-foreground">
              {t("timezoneHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-currency">{t("baseCurrency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="profile-currency">
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

/** Account tab — status, Free plan, real data export, real deletion flow. */
function AccountTab() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");

  const deletion = useQuery({
    queryKey: ["account", "deletion"],
    queryFn: () =>
      apiFetch<{ state: DeletionState }>("/api/v1/account/deletion"),
  });

  const download = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/account/export", { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          res.headers
            .get("Content-Disposition")
            ?.match(/filename="([^"]+)"/)?.[1] ?? "promethe-export.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return { ok: true as const };
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        retryAfterMs?: number;
      } | null;
      return {
        ok: false as const,
        code: body?.error ?? "ERROR",
        retryAfterMs: body?.retryAfterMs ?? 0,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast({ title: t("exportStarted") });
      } else if (result.code === "EXPORT_COOLDOWN") {
        const hours = Math.ceil(result.retryAfterMs / (60 * 60 * 1000));
        toast({
          title: t("exportCooldownTitle"),
          description: t("exportCooldownDesc", { hours }),
          variant: "destructive",
        });
      } else {
        toast({ title: tCommon("error"), variant: "destructive" });
      }
    },
    onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
  });

  const scheduleDeletion = useMutation({
    mutationFn: () =>
      apiFetch<{ state: DeletionState }>("/api/v1/account/deletion", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      setDialogOpen(false);
      setPassword("");
      setConfirmText("");
      toast({ title: t("deletionScheduledToast") });
      void queryClient.invalidateQueries({ queryKey: ["account", "deletion"] });
    },
    onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
  });

  const cancelDeletion = useMutation({
    mutationFn: () =>
      apiFetch<{ state: DeletionState }>("/api/v1/account/deletion", {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast({ title: t("deletionCancelledToast") });
      void queryClient.invalidateQueries({ queryKey: ["account", "deletion"] });
    },
    onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
  });

  const pending = deletion.data?.state?.status === "PENDING";
  const scheduledFor = deletion.data?.state?.scheduledFor;
  const confirmWord = t("confirmWord");
  const canConfirm =
    password.length >= 8 &&
    confirmText.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("accountTitle")}</CardTitle>
          <CardDescription>{t("accountDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="flex items-center justify-between gap-4 py-4 first:pt-0">
            <div>
              <p className="text-sm font-medium">{t("statusTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("statusDesc")}</p>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">
              {t("active")}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="text-sm font-medium">{t("planTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("planDesc")}</p>
            </div>
            <Badge variant="outline">{t("planName")}</Badge>
          </div>
          <div className="flex items-center justify-between gap-4 py-4 last:pb-0">
            <div>
              <p className="text-sm font-medium">{t("exportTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("exportDesc")}</p>
              <Link
                href="/settings/account"
                className="text-xs text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
              >
                {t("exportHistoryLink")}
              </Link>
            </div>
            <Button
              variant="outline"
              onClick={() => download.mutate()}
              disabled={download.isPending}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("exportButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="text-base text-red-600 dark:text-red-400">
            {t("dangerTitle")}
          </CardTitle>
          <CardDescription>{t("dangerDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {pending && scheduledFor ? (
            <Alert variant="destructive">
              <AlertTitle>{t("pendingTitle")}</AlertTitle>
              <AlertDescription>
                {t("pendingDesc", {
                  days: daysUntilDeletion(scheduledFor),
                  date: formatShortDate(scheduledFor),
                })}
              </AlertDescription>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelDeletion.mutate()}
                  disabled={cancelDeletion.isPending}
                >
                  {t("cancelDeletion")}
                </Button>
              </div>
            </Alert>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t("deleteTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("deleteDesc")}</p>
              </div>
              <Button variant="destructive" onClick={() => setDialogOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("deleteButton")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-delete-password">{t("passwordLabel")}</Label>
              <Input
                id="profile-delete-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-delete-confirm">
                {t("confirmLabel", { word: confirmWord })}
              </Label>
              <Input
                id="profile-delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => scheduleDeletion.mutate()}
              disabled={!canConfirm || scheduleDeletion.isPending}
            >
              {t("confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Security tab — change password, honest 2FA state, real active sessions. */
function SecurityTab() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [changing, setChanging] = React.useState(false);

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () =>
      apiFetch<{ sessions: SessionRow[] }>("/api/v1/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (fingerprint: string) =>
      apiFetch<{ revoked: boolean }>(
        `/api/v1/auth/sessions/${encodeURIComponent(fingerprint)}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast({ title: t("sessionRevoked") });
      void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (error) => {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    },
  });

  const passwordsMatch = newPassword === confirmPassword;
  const canChange =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    passwordsMatch;

  const onChangePassword = async () => {
    setChanging(true);
    try {
      await apiFetch<{ changed: boolean }>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: t("passwordChanged") });
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
      setChanging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("securityTitle")}</CardTitle>
        <CardDescription>{t("securityDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <div className="py-4 first:pt-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("passwordTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("passwordDesc")}</p>
            </div>
            <KeyRound
              className="h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="profile-current-password">
                {t("currentPassword")}
              </Label>
              <Input
                id="profile-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-new-password">{t("newPassword")}</Label>
              <Input
                id="profile-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-confirm-password">
                {t("confirmPassword")}
              </Label>
              <Input
                id="profile-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          {!passwordsMatch && confirmPassword.length > 0 && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {t("passwordMismatch")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-[11px] text-muted-foreground">
              {t("googleNote")}
            </p>
            <Button
              variant="outline"
              onClick={() => void onChangePassword()}
              disabled={!canChange || changing}
            >
              {changing ? t("saving") : t("changePassword")}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">{t("twoFactorTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("twoFactorDesc")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("twoFactorNote")}
            </p>
          </div>
          <Badge variant="secondary">{t("twoFactorUnavailable")}</Badge>
        </div>

        <div className="py-4 last:pb-0">
          <div>
            <p className="text-sm font-medium">{t("sessionsTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("sessionsDesc")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("sessionsNote")}
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {sessions.data?.sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("sessionsEmpty")}</p>
            )}
            {sessions.data?.sessions.map((row) => (
              <div
                key={row.fingerprint}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {t("sessionSignedIn", { date: formatShortDate(row.createdAt) })}
                    {row.current && (
                      <Badge variant="outline" className="ml-2">
                        {t("sessionCurrent")}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("sessionExpires", { date: formatShortDate(row.expiresAt) })}
                  </p>
                </div>
                {!row.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revoke.mutate(row.fingerprint)}
                    disabled={revoke.isPending}
                  >
                    {t("sessionRevoke")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Notifications tab — Discord / Telegram subscription toggles only. */
function NotificationsTab() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const integrations = useQuery({
    queryKey: ["integrations", "overview"],
    queryFn: () =>
      apiFetch<IntegrationsOverview>("/api/v1/integrations"),
  });

  const toggle = useMutation({
    mutationFn: ({
      endpointId,
      eventType,
      isEnabled,
    }: {
      endpointId: string;
      eventType: EventType;
      isEnabled: boolean;
    }) =>
      apiFetch(`/api/v1/integrations/${endpointId}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({ eventType, isEnabled }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["integrations", "overview"],
      });
    },
    onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
  });

  const endpoints = integrations.data?.endpoints ?? [];
  const subscriptions = integrations.data?.subscriptions ?? [];

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("notifTitle")}</CardTitle>
        <CardDescription>{t("notifDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {endpoints.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium">{t("notifEmptyTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("notifEmptyDesc")}</p>
            <Button variant="outline" asChild>
              <Link href="/settings/integrations">{t("notifEmptyButton")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {endpoints.map((endpoint) => (
              <div key={endpoint.id}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{endpoint.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {endpoint.type === "DISCORD_WEBHOOK" ? "Discord" : "Telegram"}
                      {!endpoint.isEnabled && ` - ${t("endpointDisabled")}`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/settings/integrations">
                      {t("notifEmptyButton")}
                    </Link>
                  </Button>
                </div>
                <div className="mt-2 divide-y">
                  {EVENT_TYPES.map((eventType) => {
                    const sub = subscriptions.find(
                      (s) =>
                        s.endpointId === endpoint.id &&
                        s.eventType === eventType
                    );
                    if (!sub) return null;
                    const quiet =
                      sub.quietHoursStart && sub.quietHoursEnd
                        ? t("quietHours", {
                            start: sub.quietHoursStart,
                            end: sub.quietHoursEnd,
                          })
                        : null;
                    return (
                      <div
                        key={eventType}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {t(eventLabelKey(eventType))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(eventDescKey(eventType))}
                            {quiet ? ` - ${quiet}` : ""}
                          </p>
                        </div>
                        <Switch
                          checked={sub.isEnabled}
                          disabled={!endpoint.isEnabled || toggle.isPending}
                          onCheckedChange={(checked) =>
                            toggle.mutate({
                              endpointId: endpoint.id,
                              eventType,
                              isEnabled: checked,
                            })
                          }
                          aria-label={t(eventLabelKey(eventType))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-[11px] text-muted-foreground">{t("notifNote")}</p>
      </CardContent>
    </Card>
      <div className="mt-4">
        <PushNotificationsSection />
      </div>
    </>
  );
}

/** Full page: header card + tab pill, same structure as the reference. */
export function ProfileView() {
  const { session } = useSession();
  const t = useTranslations("profile");
  const [tab, setTab] = React.useState<TabId>("personal");
  const [focusName, setFocusName] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<ProfileResponse>("/api/v1/profile"),
  });

  React.useEffect(() => {
    if (tab === "personal" && focusName) {
      nameRef.current?.focus();
      setFocusName(false);
    }
  }, [tab, focusName]);

  if (!session) return null;
  const { profile } = session;
  const memberSince = formatMemberSince(profileQuery.data?.user.createdAt);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-5 p-6">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-2xl font-bold text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          >
            {initialsFromName(profile.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xl font-bold">
                {profile.displayName}
              </p>
              <Badge variant="outline">{t("freePlan")}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-4 w-4" aria-hidden="true" />
                {session.user.email}
              </span>
              {memberSince !== "" && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  {t("memberSince", { date: memberSince })}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {profile.timezone}
              </span>
            </div>
          </div>
          <Button
            onClick={() => {
              setTab("personal");
              setFocusName(true);
            }}
          >
            {t("editProfile")}
          </Button>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabId)}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="personal">{t("tabPersonal")}</TabsTrigger>
          <TabsTrigger value="account">{t("tabAccount")}</TabsTrigger>
          <TabsTrigger value="security">{t("tabSecurity")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("tabNotifications")}</TabsTrigger>
        </TabsList>
        <TabsContent value="personal">
          <PersonalTab nameRef={nameRef} />
        </TabsContent>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
