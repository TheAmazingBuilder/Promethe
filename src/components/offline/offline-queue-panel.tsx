"use client";

/**
 * Offline queue panel (§25.5) - the visible queue: every queued
 * operation with its status, per-item retry and discard, and conflict
 * resolution (keep mine / keep the server version). Opened from the
 * offline banner in PwaRoot.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, RefreshCw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOfflineQueueState } from "@/lib/offline/use-offline-queue";
import type {
  OfflineItemStatus,
  OfflineOpKind,
  OfflineQueueItem,
} from "@/lib/offline/types";

function kindLabel(t: (key: string) => string, kind: OfflineOpKind): string {
  switch (kind) {
    case "TRADE_CREATE":
      return t("kindTradeCreate");
    case "JOURNAL_UPSERT":
      return t("kindJournalUpsert");
    case "NOTE_CREATE":
      return t("kindNoteCreate");
    case "NOTE_UPDATE":
      return t("kindNoteUpdate");
  }
}

function statusLabel(t: (key: string) => string, status: OfflineItemStatus): string {
  switch (status) {
    case "PENDING":
      return t("statusPending");
    case "SENDING":
      return t("statusSending");
    case "SENT":
      return t("statusSent");
    case "CONFLICT":
      return t("statusConflict");
    case "FAILED":
      return t("statusFailed");
    case "EXPIRED":
      return t("statusExpired");
  }
}

function statusVariant(
  status: OfflineItemStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "SENT":
      return "default";
    case "CONFLICT":
    case "FAILED":
      return "destructive";
    case "EXPIRED":
      return "secondary";
    default:
      return "outline";
  }
}

/** Short human summary of what the queued operation contains. */
function itemSummary(item: OfflineQueueItem): string {
  const payload = item.payload as Record<string, unknown>;
  if (item.kind === "TRADE_CREATE") {
    const direction = typeof payload.direction === "string" ? payload.direction : "";
    const entry = typeof payload.entryPrice === "string" ? payload.entryPrice : "";
    const lots = typeof payload.lots === "string" ? payload.lots : "";
    return [direction, entry ? `@ ${entry}` : "", lots ? `${lots} lots` : ""]
      .filter(Boolean)
      .join(" ");
  }
  if (item.kind === "JOURNAL_UPSERT") {
    return typeof payload.date === "string" ? payload.date : item.entityKey;
  }
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  return title === "" ? "Untitled" : title;
}

function conflictServerTime(item: OfflineQueueItem): string | null {
  const snapshot = item.conflict?.serverSnapshot as
    | { updatedAt?: unknown }
    | null
    | undefined;
  return typeof snapshot?.updatedAt === "string" ? snapshot.updatedAt : null;
}

export function OfflineQueuePanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("offlineQueue");
  const queue = useOfflineQueueState();
  const { items, isReplaying } = queue;

  const sentItems = items.filter((item) => item.status === "SENT");
  const actionable = items.filter((item) => item.status !== "SENT");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isReplaying || actionable.length === 0}
            onClick={() => void queue.replayNow()}
          >
            <RefreshCw aria-hidden="true" />
            {isReplaying ? t("syncing") : t("retryAll")}
          </Button>
          {sentItems.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void Promise.all(sentItems.map((item) => queue.discard(item.id)));
              }}
            >
              {t("clearSent")}
            </Button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border p-3"
                data-testid="offline-queue-item"
                data-status={item.status}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {kindLabel(t, item.kind)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {itemSummary(item)}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock aria-hidden="true" className="size-3" />
                      {t("createdAt", {
                        date: new Date(item.createdAt).toLocaleString(),
                      })}
                      {item.attempts > 0
                        ? ` · ${t("attempts", { count: item.attempts })}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant={statusVariant(item.status)}>
                    {statusLabel(t, item.status)}
                  </Badge>
                </div>

                {item.status === "CONFLICT" ? (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    <p className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {t("conflictDesc")}
                        {conflictServerTime(item)
                          ? ` ${new Date(conflictServerTime(item) as string).toLocaleString()}`
                          : ""}
                      </span>
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void queue.resolveConflict(item.id, "mine")}
                      >
                        {t("keepMine")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void queue.resolveConflict(item.id, "server")}
                      >
                        {t("keepServer")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {item.status === "FAILED" && item.lastError ? (
                  <p className="mt-2 text-xs text-destructive">
                    {t("failedDesc")} {item.lastError}
                  </p>
                ) : null}

                {item.status === "EXPIRED" ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t("expiredDesc")}</p>
                ) : null}

                <div className="mt-2 flex gap-2">
                  {item.status === "FAILED" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void queue.retryItem(item.id)}
                    >
                      {t("retry")}
                    </Button>
                  ) : null}
                  {item.status !== "SENDING" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void queue.discard(item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("discard")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" />
            {t("close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
