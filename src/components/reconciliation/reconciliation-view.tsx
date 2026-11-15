"use client";

/**
 * v3 — /reconciliation: queue of manual↔broker candidate pairs with
 * side-by-side diff, score + reasons, per-pair actions (merge / not a
 * duplicate / keep separate), bulk high-confidence merge and 30-day undo
 * (v3 §4.3).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CheckCheck,
  EyeOff,
  GitMerge,
  History,
  Loader2,
  RefreshCw,
  Split,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CandidateDTO } from "@/server/reconciliation";

interface MergeLogDTO {
  id: string;
  survivingTradeId: string;
  mergedAt: string;
  expiresAt: string;
  undoneAt: string | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function ScoreBadge({ score }: { score: string }) {
  const value = Number(score);
  const level =
    value >= 0.9
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : value >= 0.75
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={level}>
      {(value * 100).toFixed(0)} %
    </Badge>
  );
}

function ReasonList({ reasons }: { reasons: CandidateDTO["reasons"] }) {
  const t = useTranslations("reconciliation.reasons");
  const labels: Record<string, string> = {
    EXTERNAL_ID_MATCH: t("externalId"),
    ENTRY_TIME_STRONG: t("timeStrong"),
    ENTRY_TIME_MEDIUM: t("timeMedium"),
    ENTRY_TIME_SAME_DAY: t("timeSameDay"),
    ENTRY_TIME_SAME_DAY_DATE_ONLY: t("timeDateOnly"),
    ENTRY_TIME_DIFFERENT_DAYS: t("timeDifferentDays"),
    ENTRY_PRICE_MATCH: t("priceMatch"),
    ENTRY_PRICE_NEAR: t("priceNear"),
    LOTS_MATCH: t("lotsMatch"),
    LOTS_NEAR: t("lotsNear"),
    EXIT_MATCH: t("exitMatch"),
    EXIT_SAME_DAY: t("exitSameDay"),
    INSTRUMENT_MISMATCH: t("instrumentMismatch"),
    DIRECTION_MISMATCH: t("directionMismatch"),
  };
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("ariaReasons")}>
      {reasons
        .filter((reason) => reason.weight > 0)
        .map((reason, index) => (
          <li
            key={`${reason.code}-${index}`}
            className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
            title={reason.detail}
          >
            {labels[reason.code] ?? reason.code}
            {reason.detail ? ` (${reason.detail})` : ""}
          </li>
        ))}
    </ul>
  );
}

function TradeColumn({
  title,
  trade,
  highlight,
}: {
  title: string;
  trade: CandidateDTO["manual"] | CandidateDTO["broker"];
  highlight: boolean;
}) {
  const t = useTranslations("reconciliation.fields");
  const rows: [string, string][] = [
    [t("symbol"), trade.symbol],
    [t("direction"), trade.direction === "LONG" ? "▲" : "▼"],
    [t("entryTime"), formatTime(trade.entryTime)],
    [t("entryPrice"), trade.entryPrice],
    [t("exitTime"), formatTime(trade.exitTime)],
    [t("exitPrice"), trade.exitPrice ?? "—"],
    [t("lots"), trade.lots],
  ];
  if ("netPnl" in trade) {
    rows.push([t("netPnl"), trade.netPnl ?? "—"]);
    rows.push([t("pips"), trade.pips ?? "—"]);
    rows.push([t("source"), trade.source === "EA_SYNC" ? "EA" : "Import"]);
  } else {
    rows.push([t("strategy"), trade.strategyName ?? "—"]);
    rows.push([t("journal"), trade.hasNotes ? "✓" : "—"]);
    rows.push([t("screenshots"), String(trade.screenshotCount)]);
  }

  return (
    <div
      className={cn(
        "min-w-0 flex-1 space-y-2 rounded-lg border p-3",
        highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CandidateCard({
  candidate,
  onAction,
  busy,
}: {
  candidate: CandidateDTO;
  onAction: (id: string, action: "MERGE" | "REJECT" | "KEEP_SEPARATE") => void;
  busy: boolean;
}) {
  const t = useTranslations("reconciliation");
  const [confirmMerge, setConfirmMerge] = React.useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {candidate.manual.symbol} · {formatTime(candidate.manual.entryTime)}
          </CardTitle>
          <ScoreBadge score={candidate.score} />
        </div>
        <CardDescription>
          <ReasonList reasons={candidate.reasons} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <TradeColumn title={t("manualTitle")} trade={candidate.manual} highlight={false} />
          <TradeColumn title={t("brokerTitle")} trade={candidate.broker} highlight />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setConfirmMerge(true)} disabled={busy}>
            <GitMerge className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("merge")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction(candidate.id, "REJECT")} disabled={busy}>
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("reject")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction(candidate.id, "KEEP_SEPARATE")} disabled={busy}>
            <Split className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("keepSeparate")}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmMerge} onOpenChange={setConfirmMerge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mergeConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("mergeConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("mergeConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => onAction(candidate.id, "MERGE")}>
              {t("mergeConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function ReconciliationView() {
  const t = useTranslations("reconciliation");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: accounts } = useAccounts();

  const [candidates, setCandidates] = React.useState<CandidateDTO[] | null>(null);
  const [mergeLogs, setMergeLogs] = React.useState<MergeLogDTO[]>([]);
  const [accountFilter, setAccountFilter] = React.useState("ALL");
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const query = accountFilter !== "ALL" ? `?accountId=${accountFilter}` : "";
      const [candidateResult, logResult] = await Promise.all([
        apiFetch<{ candidates: CandidateDTO[] }>(`/api/reconciliation${query}`),
        apiFetch<{ logs: MergeLogDTO[] }>("/api/reconciliation/undo"),
      ]);
      setCandidates(candidateResult.candidates);
      setMergeLogs(logResult.logs);
    } catch (error) {
      toast({ title: t("toast.loadFailed"), description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [accountFilter, t, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onAction = async (id: string, action: "MERGE" | "REJECT" | "KEEP_SEPARATE") => {
    setBusyId(id);
    try {
      await apiFetch(`/api/reconciliation/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast({
        title:
          action === "MERGE"
            ? t("toast.merged")
            : action === "REJECT"
              ? t("toast.rejected")
              : t("toast.keptSeparate"),
      });
      await load();
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (error) {
      toast({ title: t("toast.actionFailed"), description: (error as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const onBulkMerge = async () => {
    setBulkBusy(true);
    try {
      const result = await apiFetch<{ merged: number }>("/api/reconciliation/bulk-merge", {
        method: "POST",
      });
      toast({ title: t("toast.bulkMerged", { n: result.merged }) });
      await load();
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    } catch (error) {
      toast({ title: t("toast.actionFailed"), description: (error as Error).message });
    } finally {
      setBulkBusy(false);
    }
  };

  const onUndo = async (mergeLogId: string) => {
    setBusyId(mergeLogId);
    try {
      await apiFetch("/api/reconciliation/undo", {
        method: "POST",
        body: JSON.stringify({ mergeLogId }),
      });
      toast({ title: t("toast.undone") });
      await load();
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    } catch (error) {
      toast({ title: t("toast.actionFailed"), description: (error as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const highConfidenceCount = React.useMemo(() => {
    if (!candidates) return 0;
    const byBroker = new Map<string, number>();
    for (const candidate of candidates) {
      byBroker.set(candidate.broker.id, (byBroker.get(candidate.broker.id) ?? 0) + 1);
    }
    return candidates.filter(
      (candidate) =>
        Number(candidate.score) >= 0.9 && byBroker.get(candidate.broker.id) === 1
    ).length;
  }, [candidates]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-44" aria-label={t("filterAccount")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allAccounts")}</SelectItem>
              {(accounts ?? []).map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" aria-label={t("refresh")} onClick={() => void load()}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : candidates && candidates.length > 0 ? (
        <>
          {highConfidenceCount > 0 && (
            <Alert>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>{t("bulkTitle", { n: highConfidenceCount })}</AlertTitle>
              <AlertDescription>
                {t("bulkDescription")}
                <Button size="sm" variant="outline" className="mt-2" onClick={onBulkMerge} disabled={bulkBusy}>
                  {bulkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitMerge className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {t("bulkButton")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                onAction={onAction}
                busy={busyId === candidate.id}
              />
            ))}
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <EyeOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium">{t("empty.title")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("empty.description")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Undo list */}
      {mergeLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" aria-hidden="true" />
              {t("undo.title")}
            </CardTitle>
            <CardDescription>{t("undo.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {mergeLogs.slice(0, 10).map((log) => (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-medium">{formatTime(log.mergedAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("undo.expires", { date: formatTime(log.expiresAt) })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onUndo(log.id)}
                    disabled={busyId === log.id}
                  >
                    {busyId === log.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <History className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    {t("undo.button")}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
