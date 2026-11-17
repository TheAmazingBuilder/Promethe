"use client";

/** next-news widget - upcoming high-impact economic events. */
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { fmtDateTimeInTz } from "@/lib/format";
import { asNewsData } from "./types";

export function NextNewsWidget({
  data,
  timezone,
}: {
  data: unknown;
  timezone: string;
}) {
  const t = useTranslations("dashboards");
  const events = asNewsData(data)?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("newsEmpty")}</p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {fmtDateTimeInTz(event.scheduledAt, timezone)}
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {event.currency}
            </Badge>
            {event.impact === "HIGH" ? (
              <Badge variant="destructive" className="text-[10px]">
                {t("newsHighImpact")}
              </Badge>
            ) : null}
          </div>
          <p className="leading-snug">{event.title}</p>
        </li>
      ))}
    </ul>
  );
}
