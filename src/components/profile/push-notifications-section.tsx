"use client";

/**
 * Browser push opt-in - Notification Preferences tab (/settings/profile).
 *
 * Explicit per-device opt-in, default OFF: the toggle subscribes this
 * browser to Web Push (VAPID) and stores one row per device. When the
 * server VAPID keys are not configured the section says so honestly and
 * offers no working toggle. When the browser does not support push, or
 * the user denied the permission, the reason is shown instead.
 *
 * On load, an existing browser subscription is re-synced to the server
 * (idempotent upsert): a server row deleted after a 410 Gone is recreated
 * silently, so the toggle never claims to be on while nothing arrives.
 * The test button sends one real push to this device and reports the
 * result. Push payloads are never cached (see public/sw.js).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(
    (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  );
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushNotificationsSection() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [permission, setPermission] = React.useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  const config = useQuery({
    queryKey: ["push", "config"],
    queryFn: () => apiFetch<{ available: boolean }>("/api/v1/push/config"),
  });
  const available = config.data?.available ?? null;
  const supported = pushSupported();

  React.useEffect(() => {
    if (!available || !VAPID_PUBLIC_KEY || !supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        // Re-sync: an expired server row (410) is recreated silently.
        await apiFetch("/api/v1/push/subscribe", {
          method: "POST",
          body: JSON.stringify(sub.toJSON()),
        }).catch(() => undefined);
        if (!cancelled) setSubscribed(true);
      } catch {
        // The toggle stays off; the user can retry by switching it on.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, supported]);

  async function setPush(enabled: boolean) {
    if (busy || !available || !supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) {
        if (Notification.permission === "denied") {
          setPermission("denied");
          return;
        }
        const next = await Notification.requestPermission();
        setPermission(next);
        if (next !== "granted") return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        await apiFetch("/api/v1/push/subscribe", {
          method: "POST",
          body: JSON.stringify(sub.toJSON()),
        });
        setSubscribed(true);
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await apiFetch("/api/v1/push/subscribe", {
            method: "DELETE",
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setSubscribed(false);
      }
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tCommon,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setSubscribed(false);
        return;
      }
      await apiFetch("/api/v1/push/test", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      toast({ title: t("pushTestSent") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: tCommon("error"),
        description: apiErrorMessage(
          tCommon,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pushTitle")}</CardTitle>
        <CardDescription>{t("pushDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {config.isPending ? (
          <p className="text-sm text-muted-foreground">{t("pushLoading")}</p>
        ) : available === false || !VAPID_PUBLIC_KEY ? (
          <p className="text-sm text-muted-foreground">
            {t("pushUnavailable")}
          </p>
        ) : !supported ? (
          <p className="text-sm text-muted-foreground">
            {t("pushUnsupported")}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Bell className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{t("pushTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    {subscribed ? t("pushOn") : t("pushOff")}
                  </p>
                </div>
              </div>
              <Switch
                checked={subscribed}
                disabled={busy}
                onCheckedChange={(checked) => void setPush(checked)}
                aria-label={t("pushTitle")}
              />
            </div>
            {permission === "denied" && (
              <p className="text-xs text-muted-foreground">{t("pushDenied")}</p>
            )}
            {subscribed && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void sendTest()}>
                {t("pushTest")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
