"use client";

/**
 * v2.5 Module 8 — Multi-zone clock (§3.4).
 *
 * Local time + the user's extra timezones (max 3) + the broker server time
 * of each account. Two variants:
 *  - "compact": one discreet line for the top bar (local time, then the
 *    first extra zone when one is configured) linking to #/reglages/heure;
 *  - "full": the whole list, with the calendar date when it differs from
 *    the local date (a zone can be a day ahead/behind).
 *
 * Ticks once a second (same as the market-hours clock). No amounts are
 * shown; account names go through <Sensitive kind="account">.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { useTimePrefs } from "./time-provider";
import { useI18n } from "@/i18n/i18n-provider";
import { useAccounts } from "@/hooks/use-trading";
import {
  brokerClock,
  brokerDate,
  brokerZoneLabel,
  type BrokerTimeConfig,
} from "@/lib/time/broker-time";
import {
  formatClock,
  offsetLabelOfTz,
  zonedClock,
  zonedDate,
} from "@/lib/time/zones";
import { Sensitive } from "@/components/privacy/money";
import { cn } from "@/lib/utils";

function useNowTick(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function clockText(
  now: Date,
  ianaTimezone: string,
  format: "12H" | "24H" | "LOCALE",
  locale: string
): string {
  const [h, m] = zonedClock(now, ianaTimezone).split(":").map(Number);
  return formatClock(h, m, format, locale);
}

export function MultiZoneClock({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "full";
  className?: string;
}) {
  const t = useTranslations("time");
  const { locale } = useI18n();
  const { preferences, timezone } = useTimePrefs();
  const now = useNowTick();

  const localTime = clockText(now, timezone, preferences.timeFormat, locale);
  const localDate = zonedDate(now, timezone);
  const extras = preferences.extraTimezones;

  if (variant === "compact") {
    const first = extras[0];
    return (
      <a
        href="#/reglages/heure"
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground",
          className
        )}
        aria-label={
          first != null
            ? t("clockAriaExtra", {
                local: `${localTime} ${timezone}`,
                extra: `${clockText(now, first.ianaTimezone, preferences.timeFormat, locale)} ${first.label}`,
              })
            : t("clockAria", { local: `${localTime} ${timezone}` })
        }
        title={t("clockTitle")}
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">{localTime}</span>
        <span className="hidden xl:inline">{timezone}</span>
        {first != null && (
          <>
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <span>
              {clockText(now, first.ianaTimezone, preferences.timeFormat, locale)}
            </span>
            <span className="hidden xl:inline">{first.label}</span>
          </>
        )}
      </a>
    );
  }

  return (
    <ul className={cn("divide-y", className)} aria-label={t("clockListAria")}>
      <ClockRow
        label={t("localLabel")}
        zone={timezone}
        time={localTime}
        date={localDate}
        showDate={false}
      />
      {extras.map((z) => {
        const date = zonedDate(now, z.ianaTimezone);
        return (
          <ClockRow
            key={`${z.label}-${z.ianaTimezone}`}
            label={z.label}
            zone={`${z.ianaTimezone} (${offsetLabelOfTz(now, z.ianaTimezone)})`}
            time={clockText(now, z.ianaTimezone, preferences.timeFormat, locale)}
            date={date}
            showDate={date !== localDate}
          />
        );
      })}
    </ul>
  );
}

function ClockRow({
  label,
  zone,
  time,
  date,
  showDate,
}: {
  label: string;
  zone: string;
  time: string;
  date: string;
  showDate: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{zone}</p>
      </div>
      <p className="shrink-0 text-right tabular-nums">
        <span className="text-base font-semibold">{time}</span>
        {showDate && (
          <span className="ml-2 text-xs text-muted-foreground">{date}</span>
        )}
      </p>
    </li>
  );
}

/**
 * Broker server clocks (read-only) — one row per account, with the live
 * server time and the configured clock description. The configuration
 * itself lives in the account editor (#/comptes).
 */
export function BrokerServerClocks({ className }: { className?: string }) {
  const t = useTranslations("time");
  const { locale } = useI18n();
  const { preferences } = useTimePrefs();
  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];
  const now = useNowTick();

  if (accounts.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {t("noAccounts")}
      </p>
    );
  }

  return (
    <ul className={cn("divide-y", className)} aria-label={t("brokerListAria")}>
      {accounts.map((a) => {
        const config: BrokerTimeConfig = {
          mode:
            a.serverTimezoneMode === "FIXED_OFFSET" ||
            a.serverTimezoneMode === "NY_CLOSE"
              ? a.serverTimezoneMode
              : "IANA",
          timezone: a.serverTimezone,
          fixedOffsetMinutes: a.serverFixedOffsetMinutes,
        };
        return (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                <Sensitive kind="account">{a.name}</Sensitive>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {a.broker ?? t("noBroker")} · {brokerZoneLabel(config)}
              </p>
            </div>
            <p className="shrink-0 text-right tabular-nums">
              <span className="text-base font-semibold">
                {(() => {
                  const [h, m] = brokerClock(config, now)
                    .split(":")
                    .map(Number);
                  return formatClock(h, m, preferences.timeFormat, locale);
                })()}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {brokerDate(config, now)}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
