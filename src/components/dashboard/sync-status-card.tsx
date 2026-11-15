"use client";

/**
 * v3 — Dashboard widget: broker sync status per connection + "N synced trades
 * to complete" + latest equity from heartbeats. Renders nothing when the user
 * has no connection (zero-noise for non-sync users).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, ClipboardList, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { navigate } from "@/lib/router";
import { useSyncOverview } from "@/hooks/use-broker-sync";
import { useFormat } from "@/lib/format/use-format";

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-gain",
  PENDING: "bg-amber-500 animate-pulse",
  STALE: "bg-orange-500",
  MISMATCH: "bg-loss",
  REVOKED: "bg-muted-foreground/40",
};

export function SyncStatusCard({ className }: { className?: string }) {
  const t = useTranslations("dashboard.sync");
  const fmt = useFormat();
  const { data } = useSyncOverview();

  if (!data || data.connections.length === 0) return null;

  const relative = (iso: string | null) => {
    if (!iso) return t("never");
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return t("justNow");
    if (minutes < 60) return t("minutesAgo", { n: minutes });
    return t("hoursAgo", { n: Math.round(minutes / 60) });
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="h-4 w-4" aria-hidden="true" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {data.connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[connection.status] ?? STATUS_DOT.REVOKED}`}
                />
                <span className="truncate">{connection.label}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relative(connection.lastHeartbeatAt)}
              </span>
            </li>
          ))}
        </ul>

        {data.equity.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("equity", {
              name: data.equity[0].accountName,
              value: fmt.money(data.equity[0].equity, "USD"),
            })}
          </p>
        )}

        {data.needsDetailsCount > 0 && (
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => navigate("trades")}
          >
            <span className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              {t("needsDetails", { n: data.needsDetailsCount })}
            </span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
