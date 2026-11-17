"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BellRing,
  ChevronLeft,
  MessageSquare,
  Send,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { cn } from "@/lib/utils";

type EndpointType = "DISCORD_WEBHOOK" | "TELEGRAM_BOT";
type EventType = "DAILY_SUMMARY" | "DRAWDOWN_ALERT" | "PROP_ALERT";
type PrivacyLevel = "FULL" | "NO_AMOUNTS" | "MINIMAL";

interface EndpointDTO {
  id: string;
  type: EndpointType;
  label: string;
  secretHint: string;
  chatId: string | null;
  isEnabled: boolean;
  consecutiveFailures: number;
  health: "OK" | "ERROR" | "DISABLED";
  lastErrorAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
}

interface SubscriptionDTO {
  id: string;
  endpointId: string;
  eventType: EventType;
  privacyLevel: PrivacyLevel;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  isEnabled: boolean;
}

interface OutboundMessageDTO {
  id: string;
  endpointId: string;
  endpointLabel: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface Overview {
  encryptionConfigured: boolean;
  endpoints: EndpointDTO[];
  subscriptions: SubscriptionDTO[];
  messages: OutboundMessageDTO[];
}

interface TelegramChat {
  id: string;
  title: string;
  type: string;
}

const EVENT_TYPES: EventType[] = [
  "DAILY_SUMMARY",
  "DRAWDOWN_ALERT",
  "PROP_ALERT",
];

const PRIVACY_LEVELS: PrivacyLevel[] = ["FULL", "NO_AMOUNTS", "MINIMAL"];

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

export function IntegrationsView() {
  const t = useTranslations("integrations");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const [data, setData] = React.useState<Overview | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [discordLabel, setDiscordLabel] = React.useState("");
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [telegramLabel, setTelegramLabel] = React.useState("");
  const [botToken, setBotToken] = React.useState("");
  const [chatId, setChatId] = React.useState("");
  const [chats, setChats] = React.useState<TelegramChat[]>([]);
  const [detecting, setDetecting] = React.useState(false);
  const [detectTried, setDetectTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const overview = await apiFetch<Overview>("/api/integrations");
      setData(overview);
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
      setLoading(false);
    }
  }, [toast, tRoot]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const showError = (error: unknown) => {
    const err = error instanceof ApiClientError ? error : null;
    toast({
      title: apiErrorMessage(
        tRoot,
        err?.code,
        error instanceof Error ? error.message : ""
      ),
      variant: "destructive",
    });
  };

  const createEndpoint = async (type: EndpointType) => {
    setSaving(true);
    try {
      if (type === "DISCORD_WEBHOOK") {
        await apiFetch("/api/integrations", {
          method: "POST",
          body: JSON.stringify({
            type,
            label: discordLabel.trim(),
            secret: webhookUrl.trim(),
          }),
        });
        setDiscordLabel("");
        setWebhookUrl("");
      } else {
        await apiFetch("/api/integrations", {
          method: "POST",
          body: JSON.stringify({
            type,
            label: telegramLabel.trim(),
            secret: botToken.trim(),
            chatId: chatId.trim(),
          }),
        });
        setTelegramLabel("");
        setBotToken("");
        setChatId("");
        setChats([]);
        setDetectTried(false);
      }
      toast({ title: t("created") });
      await load();
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const detectChats = async () => {
    setDetecting(true);
    setDetectTried(false);
    try {
      const result = await apiFetch<{ chats: TelegramChat[] }>(
        "/api/integrations/telegram-chats",
        {
          method: "POST",
          body: JSON.stringify({ token: botToken.trim() }),
        }
      );
      setChats(result.chats);
      setDetectTried(true);
    } catch (error) {
      showError(error);
    } finally {
      setDetecting(false);
    }
  };

  const patchEndpoint = async (
    id: string,
    patch: Record<string, unknown>
  ) => {
    try {
      await apiFetch(`/api/integrations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast({ title: t("updated") });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  const testEndpoint = async (id: string) => {
    setTestingId(id);
    try {
      await apiFetch(`/api/integrations/${id}/test`, { method: "POST" });
      toast({ title: t("testSent") });
      await load();
    } catch {
      toast({ title: t("testFailed"), variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  const deleteEndpoint = async (id: string) => {
    try {
      await apiFetch(`/api/integrations/${id}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      toast({ title: t("deleted") });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  const patchSubscription = async (
    endpointId: string,
    eventType: EventType,
    patch: Record<string, unknown>
  ) => {
    try {
      await apiFetch(`/api/integrations/${endpointId}/subscriptions`, {
        method: "POST",
        body: JSON.stringify({ eventType, ...patch }),
      });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">{t("title")}</p>
      </div>
    );
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "SENT":
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{t("statusSent")}</Badge>;
      case "FAILED":
        return <Badge variant="destructive">{t("statusFailed")}</Badge>;
      case "DEAD":
        return <Badge variant="secondary">{t("statusDead")}</Badge>;
      default:
        return <Badge variant="outline">{t("statusPending")}</Badge>;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <a
          href="#/reglages"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </a>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          {t("cronNote")}
        </p>
      </div>

      {!data.encryptionConfigured ? (
        <Card className="border-red-500/40">
          <CardContent className="pt-4 text-sm text-red-700 dark:text-red-300">
            {t("encryptionMissing")}
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">{t("encryptionOk")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {t("addDiscord")}
          </CardTitle>
          <CardDescription>{t("addDiscordDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="int-discord-label">{t("label")}</Label>
            <Input
              id="int-discord-label"
              value={discordLabel}
              onChange={(e) => setDiscordLabel(e.target.value)}
              placeholder={t("labelPlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-discord-url">{t("webhookUrl")}</Label>
            <Input
              id="int-discord-url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={t("webhookUrlPlaceholder")}
              inputMode="url"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => void createEndpoint("DISCORD_WEBHOOK")}
              disabled={
                saving ||
                !data.encryptionConfigured ||
                discordLabel.trim() === "" ||
                webhookUrl.trim() === ""
              }
            >
              {saving ? t("adding") : t("add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" aria-hidden="true" />
            {t("addTelegram")}
          </CardTitle>
          <CardDescription>{t("addTelegramDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="int-tg-label">{t("label")}</Label>
            <Input
              id="int-tg-label"
              value={telegramLabel}
              onChange={(e) => setTelegramLabel(e.target.value)}
              placeholder={t("labelPlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-tg-token">{t("botToken")}</Label>
            <Input
              id="int-tg-token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={t("botTokenPlaceholder")}
              autoComplete="off"
              type="password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-tg-chat">{t("chatId")}</Label>
            <Input
              id="int-tg-chat"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder={t("chatIdPlaceholder")}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">{t("chatIdHelp")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void detectChats()}
              disabled={detecting || botToken.trim() === ""}
            >
              {detecting ? t("detectingChats") : t("detectChats")}
            </Button>
            {detectTried && chats.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("noChatsFound")}</p>
            )}
            {chats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chats.map((chat) => (
                  <Button
                    key={chat.id}
                    variant={chatId === chat.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setChatId(chat.id)}
                  >
                    {chat.title} ({chat.type})
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => void createEndpoint("TELEGRAM_BOT")}
              disabled={
                saving ||
                !data.encryptionConfigured ||
                telegramLabel.trim() === "" ||
                botToken.trim() === "" ||
                chatId.trim() === ""
              }
            >
              {saving ? t("adding") : t("add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noEndpoints")}</p>
      ) : (
        data.endpoints.map((endpoint) => (
          <Card key={endpoint.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {endpoint.type === "DISCORD_WEBHOOK" ? "Discord" : "Telegram"}
                    {" : "}
                    {endpoint.label}
                  </CardTitle>
                  <CardDescription>
                    {endpoint.secretHint}
                    {endpoint.chatId ? ` · ${endpoint.chatId}` : ""}
                    {` · ${t("lastSent")} : ${endpoint.lastSentAt ? new Date(endpoint.lastSentAt).toLocaleString() : t("never")}`}
                  </CardDescription>
                </div>
                <Badge
                  variant={endpoint.health === "OK" ? "default" : "secondary"}
                  className={cn(
                    endpoint.health === "OK" &&
                      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                    endpoint.health === "ERROR" &&
                      "bg-red-500/15 text-red-700 dark:text-red-400"
                  )}
                >
                  {endpoint.health === "OK"
                    ? t("healthOk")
                    : endpoint.health === "DISABLED"
                      ? t("healthDisabled")
                      : `${t("healthError")} (${endpoint.consecutiveFailures})`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {endpoint.consecutiveFailures > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("failures")} : {endpoint.consecutiveFailures}.{" "}
                  {t("autoDisabledNote")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={endpoint.isEnabled}
                    onCheckedChange={(checked) =>
                      void patchEndpoint(endpoint.id, { isEnabled: checked })
                    }
                    aria-label={endpoint.isEnabled ? t("disable") : t("enable")}
                  />
                  <span className="text-sm">
                    {endpoint.isEnabled ? t("disable") : t("enable")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void testEndpoint(endpoint.id)}
                  disabled={testingId === endpoint.id || !endpoint.isEnabled}
                >
                  <BellRing className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {testingId === endpoint.id ? t("testing") : t("test")}
                </Button>
                {confirmDeleteId === endpoint.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void deleteEndpoint(endpoint.id)}
                  >
                    {t("deleteConfirm")}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(endpoint.id)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {t("delete")}
                  </Button>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t("subscriptions")}</p>
                <div className="space-y-3">
                  {EVENT_TYPES.map((eventType) => {
                    const sub = data.subscriptions.find(
                      (s) =>
                        s.endpointId === endpoint.id && s.eventType === eventType
                    );
                    if (!sub) return null;
                    return (
                      <div
                        key={eventType}
                        className="space-y-2 rounded-lg border p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {t(eventLabelKey(eventType))}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t(`${eventLabelKey(eventType)}Desc`)}
                            </p>
                          </div>
                          <Switch
                            checked={sub.isEnabled}
                            onCheckedChange={(checked) =>
                              void patchSubscription(endpoint.id, eventType, {
                                isEnabled: checked,
                              })
                            }
                            aria-label={t(eventLabelKey(eventType))}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label>{t("privacy")}</Label>
                            <Select
                              value={sub.privacyLevel}
                              onValueChange={(value) =>
                                void patchSubscription(endpoint.id, eventType, {
                                  privacyLevel: value,
                                })
                              }
                              disabled={!sub.isEnabled}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PRIVACY_LEVELS.map((level) => (
                                  <SelectItem key={level} value={level}>
                                    {t(
                                      level === "FULL"
                                        ? "privacyFull"
                                        : level === "NO_AMOUNTS"
                                          ? "privacyNoAmounts"
                                          : "privacyMinimal"
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>{`${t("quietHours")} (${t("quietHoursFrom")})`}</Label>
                            <Input
                              type="time"
                              value={sub.quietHoursStart ?? ""}
                              disabled={!sub.isEnabled}
                              onChange={(e) =>
                                void patchSubscription(endpoint.id, eventType, {
                                  quietHoursStart: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{`${t("quietHours")} (${t("quietHoursTo")})`}</Label>
                            <Input
                              type="time"
                              value={sub.quietHoursEnd ?? ""}
                              disabled={!sub.isEnabled}
                              onChange={(e) =>
                                void patchSubscription(endpoint.id, eventType, {
                                  quietHoursEnd: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {t("quietHoursHelp")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("journal")}</CardTitle>
          <CardDescription>{t("cronNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("journalEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {data.messages.map((message) => (
                <div
                  key={message.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {message.endpointLabel} · {message.eventType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("createdAt")} :{" "}
                      {new Date(message.createdAt).toLocaleString()}
                      {message.sentAt
                        ? ` · ${t("sentAt")} : ${new Date(message.sentAt).toLocaleString()}`
                        : ""}
                      {` · ${t("attempts")} : ${message.attempts}`}
                    </p>
                    {message.lastError && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {t("error")} : {message.lastError}
                      </p>
                    )}
                  </div>
                  {statusBadge(message.status)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
