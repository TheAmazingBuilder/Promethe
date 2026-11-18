"use client";

/**
 * Accounts view (v1 phase 7) — CRUD over the user's accounts incl. PROP
 * challenge fields (daily loss / total drawdown %, profit target,
 * STATIC | TRAILING, start date). Accounts with trades are never deleted
 * (409 TRADES_ON_ACCOUNT) — deactivate instead.
 * Data: GET/POST /api/accounts · PATCH/DELETE /api/accounts/[id].
 */
import * as React from "react";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
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
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
  type AccountInputBody,
} from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { COMMON_TIMEZONES } from "@/lib/time/zones";
import {
  brokerClock,
  brokerZoneLabel,
  type BrokerTimeConfig,
} from "@/lib/time/broker-time";
import { Money, Sensitive } from "@/components/privacy/money";
import type { AccountDTO } from "@/lib/trading/dto";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "NZD", "JPY"] as const;
const TYPES = ["LIVE", "DEMO", "PROP", "BACKTEST"] as const;

const EMPTY: AccountInputBody = {
  name: "",
  broker: "",
  type: "DEMO",
  currency: "USD",
  initialBalance: "10000",
  leverage: null,
  isActive: true,
  maxDailyLossPercent: null,
  maxTotalDrawdownPercent: null,
  profitTarget: null,
  drawdownType: null,
  startDate: null,
  serverTimezoneMode: "IANA",
  serverTimezone: null,
  serverFixedOffsetMinutes: null,
};

function toForm(a: AccountDTO): AccountInputBody {
  return {
    name: a.name,
    broker: a.broker ?? "",
    type: (TYPES as readonly string[]).includes(a.type)
      ? (a.type as AccountInputBody["type"])
      : "DEMO",
    currency: (CURRENCIES as readonly string[]).includes(a.currency)
      ? (a.currency as AccountInputBody["currency"])
      : "USD",
    initialBalance: a.initialBalance,
    leverage: a.leverage,
    isActive: a.isActive,
    maxDailyLossPercent: a.maxDailyLossPercent,
    maxTotalDrawdownPercent: a.maxTotalDrawdownPercent,
    profitTarget: a.profitTarget,
    drawdownType:
      a.drawdownType === "STATIC" || a.drawdownType === "TRAILING"
        ? a.drawdownType
        : null,
    startDate: a.startDate ? a.startDate.slice(0, 10) : null,
    serverTimezoneMode:
      a.serverTimezoneMode === "FIXED_OFFSET" ||
      a.serverTimezoneMode === "NY_CLOSE"
        ? a.serverTimezoneMode
        : "IANA",
    serverTimezone: a.serverTimezone,
    serverFixedOffsetMinutes: a.serverFixedOffsetMinutes,
  };
}

const POSITIVE = /^\d+(\.\d+)?$/;

function AccountEditor({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AccountDTO | null;
}) {
  const t = useTranslations("accountsView.form");
  const tView = useTranslations("accountsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const [form, setForm] = React.useState<AccountInputBody>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(editing ? toForm(editing) : EMPTY);
  }, [open, editing]);

  const set = <K extends keyof AccountInputBody>(
    key: K,
    value: AccountInputBody[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const num = (v: string | null | undefined) =>
    v == null || v.trim() === "" ? null : v.trim();

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: AccountInputBody = {
        ...form,
        name: form.name.trim(),
        broker: form.broker?.trim() === "" ? null : form.broker?.trim() ?? null,
        maxDailyLossPercent: num(form.maxDailyLossPercent),
        maxTotalDrawdownPercent: num(form.maxTotalDrawdownPercent),
        profitTarget: num(form.profitTarget),
        drawdownType: form.type === "PROP" ? form.drawdownType : null,
        startDate:
          form.type === "PROP" && form.startDate
            ? form.startDate
            : null,
        // Broker server clock: only the fields of the chosen mode are kept.
        serverTimezoneMode: form.serverTimezoneMode ?? "IANA",
        serverTimezone:
          form.serverTimezoneMode === "IANA"
            ? (form.serverTimezone ?? "UTC")
            : null,
        serverFixedOffsetMinutes:
          form.serverTimezoneMode === "FIXED_OFFSET"
            ? form.serverFixedOffsetMinutes
            : null,
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload });
        toast({ title: t("updated") });
      } else {
        await create.mutateAsync(payload);
        toast({ title: t("created") });
      }
      onOpenChange(false);
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

  const isProp = form.type === "PROP";

  // Broker server clock preview (recomputed on every render — the dialog
  // re-renders on each keystroke, so the preview stays close to live).
  const serverConfig: BrokerTimeConfig = {
    mode: form.serverTimezoneMode ?? "IANA",
    timezone: form.serverTimezone,
    fixedOffsetMinutes: form.serverFixedOffsetMinutes,
  };
  const serverNow = brokerClock(serverConfig, new Date());
  const serverLabel = brokerZoneLabel(serverConfig);
  const serverTzOptions =
    form.serverTimezone != null &&
    !COMMON_TIMEZONES.includes(form.serverTimezone)
      ? [form.serverTimezone, ...COMMON_TIMEZONES]
      : COMMON_TIMEZONES;
  const offsetHours =
    form.serverFixedOffsetMinutes == null
      ? ""
      : String(form.serverFixedOffsetMinutes / 60);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? t("editTitle") : t("createTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">{t("name")}</Label>
              <Input
                id="acc-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-broker">{t("broker")}</Label>
              <Input
                id="acc-broker"
                value={form.broker ?? ""}
                onChange={(e) => set("broker", e.target.value)}
                placeholder="FTMO, IC Markets…"
                maxLength={80}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-type">{t("type")}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => set("type", v as AccountInputBody["type"])}
              >
                <SelectTrigger id="acc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {tView(`type.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-currency">{t("currency")}</Label>
              <Select
                value={form.currency}
                onValueChange={(v) =>
                  set("currency", v as AccountInputBody["currency"])
                }
              >
                <SelectTrigger id="acc-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-balance">{t("initialBalance")}</Label>
              <Input
                id="acc-balance"
                inputMode="decimal"
                value={form.initialBalance}
                onChange={(e) => set("initialBalance", e.target.value)}
                placeholder="10000"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-leverage">{t("leverage")}</Label>
              <Input
                id="acc-leverage"
                inputMode="numeric"
                value={form.leverage ?? ""}
                onChange={(e) =>
                  set(
                    "leverage",
                    e.target.value.trim() === ""
                      ? null
                      : Number(e.target.value) || null
                  )
                }
                placeholder="100"
              />
            </div>
            <div className="flex items-end justify-between rounded-md border p-3">
              <Label htmlFor="acc-active">{t("active")}</Label>
              <Switch
                id="acc-active"
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
              />
            </div>
          </div>

          {/* ── Broker server time (v2.5 M8) ── */}
          <div className="space-y-3 rounded-lg border border-dashed p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {t("serverTimeSection")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("serverTimeHint")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-server-mode">{t("serverTimeMode")}</Label>
                <Select
                  value={form.serverTimezoneMode ?? "IANA"}
                  onValueChange={(v) =>
                    set(
                      "serverTimezoneMode",
                      v as NonNullable<AccountInputBody["serverTimezoneMode"]>
                    )
                  }
                >
                  <SelectTrigger id="acc-server-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IANA">{t("serverTimeModeIana")}</SelectItem>
                    <SelectItem value="FIXED_OFFSET">{t("serverTimeModeFixed")}</SelectItem>
                    <SelectItem value="NY_CLOSE">{t("serverTimeModeNyClose")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.serverTimezoneMode === "IANA" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="acc-server-tz">{t("serverTimeZone")}</Label>
                  <Select
                    value={form.serverTimezone ?? "UTC"}
                    onValueChange={(v) => set("serverTimezone", v)}
                  >
                    <SelectTrigger id="acc-server-tz">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {serverTzOptions.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : form.serverTimezoneMode === "FIXED_OFFSET" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="acc-server-offset">{t("serverTimeOffset")}</Label>
                  <Input
                    id="acc-server-offset"
                    inputMode="decimal"
                    value={offsetHours}
                    onChange={(e) => {
                      const raw = e.target.value.trim().replace(",", ".");
                      if (raw === "" || raw === "+" || raw === "-") {
                        set("serverFixedOffsetMinutes", null);
                        return;
                      }
                      const hours = Number(raw);
                      if (!Number.isFinite(hours)) return;
                      const minutes = Math.round(hours * 60);
                      set(
                        "serverFixedOffsetMinutes",
                        Math.max(-720, Math.min(840, minutes))
                      );
                    }}
                    placeholder="+2"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("serverTimeOffsetHint")}
                  </p>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums" role="status">
              {t("serverTimeNow", { time: serverNow, zone: serverLabel })}
            </p>
          </div>

          {isProp && (
            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <p className="text-xs font-semibold text-muted-foreground">
                {t("propSection")}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="acc-daily">{t("maxDailyLoss")}</Label>
                  <Input
                    id="acc-daily"
                    inputMode="decimal"
                    value={form.maxDailyLossPercent ?? ""}
                    onChange={(e) =>
                      set("maxDailyLossPercent", num(e.target.value))
                    }
                    placeholder="5"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-dd">{t("maxDrawdown")}</Label>
                  <Input
                    id="acc-dd"
                    inputMode="decimal"
                    value={form.maxTotalDrawdownPercent ?? ""}
                    onChange={(e) =>
                      set("maxTotalDrawdownPercent", num(e.target.value))
                    }
                    placeholder="10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-target">{t("profitTarget")}</Label>
                  <Input
                    id="acc-target"
                    inputMode="decimal"
                    value={form.profitTarget ?? ""}
                    onChange={(e) => set("profitTarget", num(e.target.value))}
                    placeholder="10000"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="acc-ddtype">{t("drawdownType")}</Label>
                  <Select
                    value={form.drawdownType ?? "none"}
                    onValueChange={(v) =>
                      set(
                        "drawdownType",
                        v === "STATIC" || v === "TRAILING" ? v : null
                      )
                    }
                  >
                    <SelectTrigger id="acc-ddtype">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("noDrawdownType")}</SelectItem>
                      <SelectItem value="STATIC">{t("ddStatic")}</SelectItem>
                      <SelectItem value="TRAILING">{t("ddTrailing")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-start">{t("startDate")}</Label>
                  <DateField
                    id="acc-start"
                    value={form.startDate ?? ""}
                    onChange={(v) =>
                      set(
                        "startDate",
                        v.trim() === "" ? null : v
                      )
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void onSave()}
            disabled={
              saving ||
              form.name.trim() === "" ||
              !POSITIVE.test(form.initialBalance.trim())
            }
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "LIVE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "PROP":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "BACKTEST":
      return "bg-violet-500/15 text-violet-700 dark:text-violet-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function AccountsView() {
  const t = useTranslations("accountsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const accounts = useAccounts();
  const del = useDeleteAccount();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AccountDTO | null>(null);

  const list = accounts.data ?? [];

  const onEdit = (a: AccountDTO) => {
    setEditing(a);
    setEditorOpen(true);
  };
  const onCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const onDelete = async (a: AccountDTO) => {
    try {
      await del.mutateAsync(a.id);
      toast({ title: t("deletedToast") });
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
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button className="shrink-0" onClick={onCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
          </Button>
        }
      />

      {accounts.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Wallet className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Button size="sm" onClick={onCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("add")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((a) => (
            <Card key={a.id} className={a.isActive ? "" : "opacity-60"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sensitive kind="account" className="truncate">
                    {a.name}
                  </Sensitive>
                  <Badge className={typeBadgeClass(a.type)}>
                    {t(`type.${a.type}`)}
                  </Badge>
                  {!a.isActive && (
                    <Badge variant="secondary">{t("inactiveBadge")}</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {a.broker ? (
                    <>
                      <Sensitive kind="broker">{a.broker}</Sensitive>
                      {" · "}
                    </>
                  ) : (
                    ""
                  )}
                  <Money kind="balance" value={a.initialBalance} currency={a.currency} />
                  {a.leverage ? ` · 1:${a.leverage}` : ""}
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("edit")}
                      onClick={() => onEdit(a)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("delete")}
                      onClick={() => void onDelete(a)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {a.type === "PROP" ? (
                  <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">
                        {t("propDaily")}
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {a.maxDailyLossPercent
                          ? `−${a.maxDailyLossPercent}%`
                          : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("propDd")}</dt>
                      <dd className="font-medium tabular-nums">
                        {a.maxTotalDrawdownPercent
                          ? `−${a.maxTotalDrawdownPercent}%${
                              a.drawdownType === "TRAILING" ? " ↗" : ""
                            }`
                          : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {t("propTarget")}
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {a.profitTarget ? (
                          <Money value={a.profitTarget} currency={a.currency} />
                        ) : (
                          "-"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("propStart")}</dt>
                      <dd className="font-medium tabular-nums">
                        {a.startDate ? a.startDate.slice(0, 10) : "-"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("plainHint")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AccountEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />
    </div>
  );
}
