"use client";

/**
 * v3 — /settings/broker-sync: connection wizard & management.
 *
 * Wizard flow (v3 §4.1): create a connection (token shown ONCE with copy
 * buttons), download the EA, whitelist the app URL in MetaTrader, wait for
 * the first heartbeat. Status badges: PENDING / ACTIVE / STALE / MISMATCH /
 * REVOKED. Honest requirements are displayed (VPS, one-way read-only sync,
 * WebRequest limitations).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/ui/query-error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { useAccounts, useStrategies } from "@/hooks/use-trading";
import {
  useBrokerConnections,
  useCreateConnection,
  useCreateMagicMapping,
  useDeleteMagicMapping,
  useMagicMappings,
  useRevokeConnection,
  useRotateConnection,
  useSymbolMappings,
  useSyncOverview,
  useUpdateConnection,
  useUpsertSymbolMapping,
  type BrokerConnection,
} from "@/hooks/use-broker-sync";
import type { CreatedConnection } from "@/server/broker-sync";

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("brokerSync.status");
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
    PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
    STALE: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40",
    MISMATCH: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40",
    REVOKED: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={styles[status] ?? styles.REVOKED}>
      {status === "MISMATCH" && <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />}
      {status === "STALE" && <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />}
      {status === "ACTIVE" && <Check className="mr-1 h-3 w-3" aria-hidden="true" />}
      {t(status.toLowerCase() as "active")}
    </Badge>
  );
}

// ── Token shown ONCE dialog ──────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={copied ? "Copied" : "Copy"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast({ title: "Copy failed", description: "Copiez manuellement." });
            }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function TokenOnceDialog({
  created,
  onClose,
}: {
  created: CreatedConnection | null;
  onClose: () => void;
}) {
  const t = useTranslations("brokerSync.tokenDialog");
  const appUrl =
    typeof window !== "undefined" ? window.location.origin : "";
  const eaFile = created?.connection.platform === "MT4"
    ? "/ea/PrometheSync.mq4"
    : "/ea/PrometheSync.mq5";

  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {created && (
          <div className="space-y-4">
            <CopyField label={t("endpointLabel")} value={`${appUrl}/api/ingest/mt`} />
            <CopyField label={t("tokenLabel")} value={created.token} />
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              {t("warningOnce")}
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                {t("step1")}{" "}
                <a
                  href={eaFile}
                  download
                  className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                >
                  <Download className="h-3 w-3" aria-hidden="true" />
                  {created.connection.platform === "MT4" ? "PrometheSync.mq4" : "PrometheSync.mq5"}
                </a>
              </li>
              <li>{t("step2")}</li>
              <li>
                {t("step3", { url: appUrl })}
              </li>
              <li>{t("step4")}</li>
              <li>{t("step5")}</li>
            </ol>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t("done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({ connection }: { connection: BrokerConnection }) {
  const t = useTranslations("brokerSync");
  const { toast } = useToast();
  const rotate = useRotateConnection();
  const revoke = useRevokeConnection();
  const update = useUpdateConnection();
  const [created, setCreated] = React.useState<CreatedConnection | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const relative = (iso: string | null) => {
    if (!iso) return t("never");
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return t("justNow");
    if (minutes < 60) return t("minutesAgo", { n: minutes });
    return t("hoursAgo", { n: Math.round(minutes / 60) });
  };

  const onRotate = async () => {
    setBusy(true);
    try {
      const result = await rotate.mutateAsync(connection.id);
      setCreated({ connection: result.connection, token: result.token, ingestUrl: "" });
    } catch (error) {
      toast({ title: t("toast.rotateFailed"), description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="truncate">{connection.label}</span>
              <Badge variant="secondary" className="shrink-0">{connection.platform}</Badge>
            </CardTitle>
            <CardDescription className="mt-1 truncate">
              {connection.accountName} · {connection.tokenPrefix}…
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={connection.status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("actionsLabel")} disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span aria-hidden="true">⋯</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onRotate} disabled={connection.status === "REVOKED"}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t("actions.rotate")}
                </DropdownMenuItem>
                {connection.status === "MISMATCH" && (
                  <DropdownMenuItem
                    onClick={() =>
                      update.mutate({ id: connection.id, resetBinding: true })
                    }
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    {t("actions.resetBinding")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 dark:text-red-400"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={connection.status === "REVOKED"}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("actions.revoke")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.server")}</dt>
            <dd className="truncate font-medium">{connection.brokerServer ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.login")}</dt>
            <dd className="truncate font-medium">{connection.brokerLogin ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.heartbeat")}</dt>
            <dd className="truncate font-medium">{relative(connection.lastHeartbeatAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.lastEvent")}</dt>
            <dd className="truncate font-medium">{relative(connection.lastEventAt)}</dd>
          </div>
        </dl>
        {connection.eaVersion && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("fields.eaVersion")}: {connection.eaVersion}
          </p>
        )}
        {connection.status === "MISMATCH" && (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
            {t("mismatchExplanation")}
          </p>
        )}
      </CardContent>

      <TokenOnceDialog created={created} onClose={() => setCreated(null)} />

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("revokeConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("revokeConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async () => {
                try {
                  await revoke.mutateAsync(connection.id);
                  toast({ title: t("toast.revoked") });
                } catch (error) {
                  toast({ title: t("toast.revokeFailed"), description: (error as Error).message });
                }
              }}
            >
              {t("revokeConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Create connection dialog ────────────────────────────────────────────────

function CreateConnectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedConnection) => void;
}) {
  const t = useTranslations("brokerSync.createDialog");
  const { toast } = useToast();
  const { data: accounts } = useAccounts();
  const create = useCreateConnection();
  const [accountId, setAccountId] = React.useState("");
  const [platform, setPlatform] = React.useState<"MT4" | "MT5">("MT5");
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    if (open && accounts && accounts.length > 0 && !accountId) {
      setAccountId(accounts[0].id);
    }
  }, [open, accounts, accountId]);

  const submit = async () => {
    if (!accountId || !label.trim()) return;
    try {
      const created = await create.mutateAsync({
        accountId,
        platform,
        label: label.trim(),
      });
      onCreated(created);
      onOpenChange(false);
      setLabel("");
    } catch (error) {
      toast({ title: t("failed"), description: (error as Error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conn-account">{t("account")}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="conn-account">
                <SelectValue placeholder={t("accountPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("platform")}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("platform")}>
              {(["MT5", "MT4"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  onClick={() => setPlatform(p)}
                  className={
                    platform === p
                      ? "rounded-lg border border-emerald-500/60 bg-emerald-500/10 p-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                      : "rounded-lg border p-2.5 text-sm text-muted-foreground hover:bg-accent"
                  }
                >
                  MetaTrader {p === "MT5" ? "5" : "4"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="conn-label">{t("label")}</Label>
            <Input
              id="conn-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("labelPlaceholder")}
              maxLength={60}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!accountId || !label.trim() || create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Symbol mappings section ─────────────────────────────────────────────────

function SymbolMappingsSection() {
  const t = useTranslations("brokerSync.mappings");
  const { data: mappings, isLoading, isError, refetch } = useSymbolMappings();
  const upsert = useUpsertSymbolMapping();
  const { toast } = useToast();

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (isError) {
    return (
      <QueryErrorState
        title="Symbol mappings could not be loaded"
        onRetry={() => void refetch()}
      />
    );
  }
  if (!mappings || mappings.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {mappings.map((mapping) => (
        <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium">{mapping.brokerSymbol}</p>
            <p className="text-xs text-muted-foreground">
              → {mapping.instrumentSymbol} · pip {mapping.instrumentPipSize}
            </p>
          </div>
          {mapping.autoResolved ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
              {t("autoResolved")}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              <Check className="mr-1 h-3 w-3" aria-hidden="true" />
              {t("confirmed")}
            </Badge>
          )}
          {mapping.autoResolved && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                upsert.mutate(
                  {
                    brokerSymbol: mapping.brokerSymbol,
                    instrumentId: mapping.instrumentId,
                  },
                  {
                    onSuccess: () => toast({ title: t("confirmedToast") }),
                  }
                );
              }}
            >
              {t("confirmPip")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Magic mappings section ──────────────────────────────────────────────────

function MagicMappingsSection() {
  const t = useTranslations("brokerSync.magic");
  const {
    data: mappings,
    isError: mappingsError,
    refetch: refetchMappings,
  } = useMagicMappings();
  const {
    data: strategies,
    isError: strategiesError,
    refetch: refetchStrategies,
  } = useStrategies();
  const create = useCreateMagicMapping();
  const remove = useDeleteMagicMapping();
  const { toast } = useToast();
  const [magic, setMagic] = React.useState("");
  const [strategyId, setStrategyId] = React.useState("");

  if (mappingsError || strategiesError) {
    return (
      <QueryErrorState
        title="Magic mappings could not be loaded"
        onRetry={() => {
          void Promise.all([refetchMappings(), refetchStrategies()]);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="magic-number" className="text-xs">
            {t("number")}
          </Label>
          <Input
            id="magic-number"
            inputMode="numeric"
            value={magic}
            onChange={(event) => setMagic(event.target.value.replace(/\D/g, ""))}
            placeholder="777"
            className="w-24"
          />
        </div>
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor="magic-strategy" className="text-xs">
            {t("strategy")}
          </Label>
          <Select value={strategyId} onValueChange={setStrategyId}>
            <SelectTrigger id="magic-strategy">
              <SelectValue placeholder={t("strategyPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(strategies ?? []).map((strategy) => (
                <SelectItem key={strategy.id} value={strategy.id}>
                  {strategy.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={!magic || !strategyId || create.isPending}
          onClick={() =>
            create.mutate(
              { magicNumber: magic, strategyId },
              {
                onSuccess: () => {
                  setMagic("");
                  toast({ title: t("added") });
                },
                onError: (error) => toast({ title: t("addFailed"), description: error.message }),
              }
            )
          }
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("add")}
        </Button>
      </div>

      {mappings && mappings.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {mappings.map((mapping) => (
            <li key={mapping.id} className="flex items-center justify-between gap-2 p-3">
              <div>
                <p className="font-mono text-sm font-medium">#{mapping.magicNumber}</p>
                <p className="text-xs text-muted-foreground">→ {mapping.strategyName}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("remove")}
                onClick={() => remove.mutate(mapping.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {t("empty")}
        </p>
      )}
    </div>
  );
}

// ── Recent sync activity ───────────────────────────────────────────────────

function ActivitySection() {
  const t = useTranslations("brokerSync.activity");
  const { data: overview, isLoading, isError, refetch } = useSyncOverview();

  const relative = (iso: string) => {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
    return new Date(iso).toLocaleDateString("en-CA");
  };

  const statusStyle: Record<string, string> = {
    PROCESSED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    DUPLICATE: "border-border text-muted-foreground",
    REJECTED: "border-red-500/40 text-red-700 dark:text-red-400",
    FAILED: "border-red-500/40 text-red-700 dark:text-red-400",
    PROCESSING: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <QueryErrorState
            title="Recent sync activity could not be loaded"
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !overview || overview.recentEvents.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {overview.recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium">
                    {event.type}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.connectionLabel} · {relative(event.receivedAt)}
                    {event.errorCode ? ` · ${event.errorCode}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className={statusStyle[event.status] ?? statusStyle.DUPLICATE}>
                  {t(`status.${event.status.toLowerCase()}` as "processed")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function BrokerSyncView() {
  const t = useTranslations("brokerSync");
  const {
    data: connections,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useBrokerConnections();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedConnection | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("refresh")}
            onClick={() => refetch()}
          >
            <RefreshCw className={isRefetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("create")}
          </Button>
          </div>
        }
      />

      {/* Honest requirements */}
      <Card className="border-border bg-muted/30">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Plug className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("requirements.oneWay")}
          </p>
          <p className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("requirements.running")}
          </p>
          <p className="flex items-start gap-2">
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("requirements.webRequest")}
          </p>
        </CardContent>
      </Card>

      {/* Connections */}
      {isError ? (
        <QueryErrorState
          title="Broker connections could not be loaded"
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : !connections || connections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Plug className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">{t("empty.title")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("empty.description")}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("empty.cta")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} />
          ))}
        </div>
      )}

      {/* Recent activity */}
      <ActivitySection />

      {/* Symbol mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("mappings.title")}</CardTitle>
          <CardDescription>{t("mappings.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SymbolMappingsSection />
        </CardContent>
      </Card>

      {/* Magic mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("magic.title")}</CardTitle>
          <CardDescription>{t("magic.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <MagicMappingsSection />
        </CardContent>
      </Card>

      <CreateConnectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setCreated}
      />
      <TokenOnceDialog created={created} onClose={() => setCreated(null)} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t("footerNote")}
      </p>
    </div>
  );
}
