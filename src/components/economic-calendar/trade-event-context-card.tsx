"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/app/session-context";
import { fmtDateTimeInTz } from "@/lib/format";
import { useTradeEventContext } from "@/hooks/use-economic-calendar";

/**
 * Market context around one trade: the ATR/regime snapshot captured at
 * entry (when candles allowed computing one) and the economic events
 * linked to the trade, with their phase relative to the entry.
 * Renders nothing while loading; the empty states live inside the card.
 */
export function TradeEventContextCard({ tradeId }: { tradeId: string }) {
  const t = useTranslations("economicCalendar");
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";
  const query = useTradeEventContext(tradeId);
  const context = query.data?.context;
  if (query.isPending || !context) return null;

  const snapshot = context.snapshot;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("tradeContextTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="mb-1 font-medium">{t("snapshotTitle")}</p>
          {snapshot ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("atr")}</dt>
                <dd className="tabular-nums">{snapshot.atr14Pips} pips</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("volatility")}</dt>
                <dd>{snapshot.volatilityRegime}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("trend")}</dt>
                <dd>{snapshot.trendRegime}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground">{t("snapshotEmpty")}</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium">{t("linkedTrades")}</p>
          {context.events.length === 0 ? (
            <p className="text-muted-foreground">{t("tradeContextEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {context.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {fmtDateTimeInTz(event.scheduledAt, timezone)}
                  </span>
                  <span>{event.title}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {event.currency}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {t(
                      event.phase === "BEFORE"
                        ? "phaseBefore"
                        : event.phase === "DURING"
                          ? "phaseDuring"
                          : "phaseAfter",
                    )}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
