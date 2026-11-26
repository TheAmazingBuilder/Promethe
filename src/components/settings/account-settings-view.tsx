"use client";

/**
 * v3 Phase 6 — Account, data portability & deletion, /settings/account.
 *
 * Three cards:
 *  1. Export — full ZIP download (RGPD art. 20), 24 h cooldown, history.
 *  2. Deletion — danger zone: password re-auth, 7-day grace, countdown and
 *     cancellation. The banner is mirrored app-wide (app-shell).
 *  3. Consents — TERMS/PRIVACY proof history (RGPD art. 7).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Lock,
  ScrollText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

interface ExportHistoryRow {
  id: string;
  createdAt: string;
  kind: string;
  sizeBytes: number | null;
  schemaVersion: string;
}

type DeletionState = {
  status: "PENDING" | "CANCELLED" | "COMPLETED";
  requestedAt: string;
  scheduledFor: string;
} | null;

interface ConsentRow {
  id: string;
  type: string;
  version: string;
  granted: boolean;
  choices: unknown;
  createdAt: string;
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function AccountSettingsView() {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");

  const history = useQuery({
    queryKey: ["account", "export-history"],
    queryFn: () =>
      apiFetch<{ history: ExportHistoryRow[] }>("/api/v1/account/export/history"),
  });

  const deletion = useQuery({
    queryKey: ["account", "deletion"],
    queryFn: () => apiFetch<{ state: DeletionState }>("/api/v1/account/deletion"),
  });

  const consents = useQuery({
    queryKey: ["account", "consents"],
    queryFn: () => apiFetch<{ consents: ConsentRow[] }>("/api/v1/account/consents"),
  });

  const refreshDeletion = () => {
    void queryClient.invalidateQueries({ queryKey: ["account", "deletion"] });
  };

  // Download via fetch (not <a href>) to surface cooldown errors as toasts.
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
            ?.match(/filename="([^"]+)"/)?.[1] ?? "tradejournal-export.zip";
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
        message: body?.message ?? "",
        retryAfterMs: body?.retryAfterMs ?? 0,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast({ title: t("exportStarted") });
        void queryClient.invalidateQueries({
          queryKey: ["account", "export-history"],
        });
      } else if (result.code === "EXPORT_COOLDOWN") {
        const hours = Math.ceil(result.retryAfterMs / (60 * 60 * 1000));
        toast({
          title: t("exportCooldownTitle"),
          description: t("exportCooldownDesc", { hours }),
          variant: "destructive",
        });
      } else {
        toast({
          title: tCommon("error"),
          description: result.message || tCommon("error"),
          variant: "destructive",
        });
      }
    },
  });

  const schedule = useMutation({
    mutationFn: (pwd: string) =>
      apiFetch<{ state: DeletionState }>("/api/v1/account/deletion", {
        method: "POST",
        body: JSON.stringify({ password: pwd }),
      }),
    onSuccess: () => {
      setDialogOpen(false);
      setPassword("");
      setConfirmText("");
      refreshDeletion();
      toast({ title: t("deletionScheduledToast") });
    },
    onError: (error: Error) => {
      const code = error instanceof ApiClientError ? error.code : "";
      toast({
        title:
          code === "BAD_PASSWORD"
            ? t("badPassword")
            : code === "ALREADY_PENDING"
              ? t("alreadyPending")
              : tCommon("error"),
        variant: "destructive",
      });
    },
  });

  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<{ state: DeletionState }>("/api/v1/account/deletion", {
        method: "DELETE",
      }),
    onSuccess: () => {
      refreshDeletion();
      toast({ title: t("deletionCancelledToast") });
    },
    onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
  });

  const pending = deletion.data?.state?.status === "PENDING";
  const scheduledFor = deletion.data?.state?.scheduledFor;
  const daysLeft = scheduledFor
    ? Math.max(
        0,
        Math.ceil((new Date(scheduledFor).getTime() - Date.now()) / 86_400_000)
      )
    : 0;

  const confirmWord = t("confirmWord");
  const canConfirm =
    password.length >= 8 &&
    confirmText.trim().toUpperCase() === confirmWord.toUpperCase();

  // Closed map — unknown DB types fall back to the raw value.
  const consentLabels: Record<string, string> = {
    TERMS: t("consentType.TERMS"),
    PRIVACY: t("consentType.PRIVACY"),
    COOKIES_PREFERENCES: t("consentType.COOKIES_PREFERENCES"),
    MARKETING_EMAIL: t("consentType.MARKETING_EMAIL"),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            {t("title")}
          </span>
        }
        description={t("subtitle")}
      />

      {/* ── 1. Data export ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            {t("exportTitle")}
          </CardTitle>
          <CardDescription>{t("exportDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => download.mutate()}
              disabled={download.isPending}
            >
              {download.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {t("exportButton")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("exportNote")}</p>
          </div>

          {history.data && history.data.history.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t("exportHistory")}
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
                {history.data.history.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-4 rounded-md border px-3 py-1.5"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <FileArchive
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {format(new Date(row.createdAt), "PPpp")}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {fmtSize(row.sizeBytes)} · v{row.schemaVersion}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Deletion (danger zone) ──────────────────────────────────── */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t("deletionTitle")}
          </CardTitle>
          <CardDescription>{t("deletionDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending && scheduledFor && (
            <Alert variant="destructive">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>
                {t("pendingTitle", {
                  date: format(new Date(scheduledFor), "PPP"),
                  days: daysLeft,
                })}
              </AlertTitle>
              <AlertDescription>{t("pendingDesc")}</AlertDescription>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("cancelButton")}
                </Button>
              </div>
            </Alert>
          )}

          {!pending && (
            <>
              <p className="text-sm text-muted-foreground">{t("deletionGrace")}</p>
              <Button variant="destructive" onClick={() => setDialogOpen(true)}>
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t("deleteButton")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── 3. Consents ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" aria-hidden="true" />
            {t("consentsTitle")}
          </CardTitle>
          <CardDescription>{t("consentsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {consents.isLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : consents.data && consents.data.consents.length > 0 ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
              {consents.data.consents.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-4 rounded-md border px-3 py-1.5"
                >
                  <span className="text-muted-foreground">
                    {consentLabels[row.type] ?? row.type}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {format(new Date(row.createdAt), "PP")}
                    <Badge
                      variant={row.granted ? "secondary" : "destructive"}
                      className="gap-1"
                    >
                      {row.granted ? (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                      )}
                      {row.granted ? t("granted") : t("refused")}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noConsents")}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Deletion confirmation dialog ──────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="delete-password">{t("passwordLabel")}</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                {t("confirmLabel", { word: confirmWord })}
              </Label>
              <Input
                id="delete-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmWord}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirm || schedule.isPending}
              onClick={() => schedule.mutate(password)}
            >
              {schedule.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              <Lock className="h-4 w-4" aria-hidden="true" />
              {t("confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
