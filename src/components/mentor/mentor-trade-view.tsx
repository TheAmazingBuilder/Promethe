"use client";

/**
 * v3 Phase 5 — Read-only trade detail in the mentor space,
 * /mentor/{ownerId}/trades/{tradeId}. The payload arrives ALREADY scoped
 * and redacted from the server (journal/psychology/screenshots/amounts
 * structurally absent when disallowed). Read-only badge on every field;
 * the comment thread is the one collaborative surface.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { ArrowLeft, EyeOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { useSession } from "@/components/app/session-context";
import { CommentThread } from "@/components/comments/comment-thread";

interface MentorTradePayload {
  trade: Record<string, unknown>;
  policy: {
    hideAmounts: boolean;
    hideAccountInfo: boolean;
    hideNotes: boolean;
    hideScreenshots: boolean;
    hideStrategyName: boolean;
    hideExactTimes: boolean;
    hidePsychology: boolean;
  };
}

export function MentorTradeView({
  ownerId,
  tradeId,
}: {
  ownerId: string;
  tradeId: string;
}) {
  const t = useTranslations("mentorSpace");
  const { session } = useSession();
  const detail = useQuery({
    queryKey: ["mentor-trade", ownerId, tradeId],
    queryFn: () =>
      apiFetch<MentorTradePayload>(
        `/api/v1/mentor/${ownerId}/trades/${tradeId}`
      ),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => navigate(`/mentor/${ownerId}`)}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToMentees")}
      </Button>

      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : detail.error ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-sm text-muted-foreground">
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          {t("loadError")}
        </div>
      ) : detail.data ? (
        <MentorTradeBody
          payload={detail.data}
          ownerId={ownerId}
          viewerId={session?.user.id ?? ""}
        />
      ) : null}
    </div>
  );
}

function MentorTradeBody({
  payload,
  ownerId,
  viewerId,
}: {
  payload: MentorTradePayload;
  ownerId: string;
  viewerId: string;
}) {
  const trade = payload.trade;
  const policy = payload.policy;
  const s = (key: string): string => {
    const value = trade[key];
    return value === undefined || value === null ? "-" : String(value);
  };

  const screenshots = Array.isArray(trade.screenshots)
    ? (trade.screenshots as { id: string; url: string; label?: string }[])
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-lg">{s("symbol")}</span>
            <Badge
              variant="outline"
              className={
                trade.direction === "LONG"
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                  : "border-rose-500/40 text-rose-700 dark:text-rose-400"
              }
            >
              {s("direction")}
            </Badge>
            <Badge variant="secondary">{s("status")}</Badge>
            {!policy.hideStrategyName && trade.strategyName ? (
              <Badge variant="outline">{s("strategyName")}</Badge>
            ) : null}
            {policy.hideAmounts && (
              <Badge variant="outline" className="text-muted-foreground">
                pips & R
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Entry" value={fmt(s("entryTime"), policy.hideExactTimes)} />
            <Row label="Exit" value={fmt(s("exitTime"), policy.hideExactTimes)} />
            <Row label="Timeframe" value={s("timeframe")} />
            <Row label="Entry price" value={s("entryPrice")} />
            <Row label="Exit price" value={s("exitPrice")} />
            <Row label="Stop loss" value={s("stopLoss")} />
            <Row label="Take profit" value={s("takeProfit")} />
            <Row label="Session" value={s("session")} />
            <Row label="Setup" value={s("setupType")} />
            <Row label="Pips" value={s("pips")} />
            <Row label="R" value={s("rMultiple")} />
            {!policy.hideAmounts && <Row label="Net P&L" value={s("netPnl")} />}
            {!policy.hideAccountInfo && (
              <Row label="Account" value={s("accountName")} />
            )}
          </dl>

          {Array.isArray(trade.tags) && trade.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {(trade.tags as { name: string }[]).map((tag) => (
                <Badge key={tag.name} variant="secondary">
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!policy.hideNotes && (trade.notes || trade.preTradeAnalysis || trade.postTradeReview) ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Journal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {trade.preTradeAnalysis ? (
              <TextBlock label="Pre-trade" text={String(trade.preTradeAnalysis)} />
            ) : null}
            {trade.postTradeReview ? (
              <TextBlock label="Post-trade" text={String(trade.postTradeReview)} />
            ) : null}
            {trade.notes ? <TextBlock label="Notes" text={String(trade.notes)} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {screenshots.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Captures</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {screenshots.map((shot) => (
              <img
                key={shot.id}
                src={shot.url}
                alt={shot.label ?? "Trade screenshot"}
                loading="lazy"
                className="rounded-md border"
              />
            ))}
          </CardContent>
        </Card>
      )}

      <CommentThread
        tradeId={String(trade.id)}
        viewerId={viewerId}
        ownerView={false}
      />
    </div>
  );
}

function fmt(iso: string, dateOnly: boolean): string {
  if (!iso || iso === "-") return "-";
  try {
    return dateOnly
      ? format(new Date(iso), "yyyy-MM-dd")
      : format(new Date(iso), "d MMM yyyy · HH:mm");
  } catch {
    return iso;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{text}</p>
    </div>
  );
}
