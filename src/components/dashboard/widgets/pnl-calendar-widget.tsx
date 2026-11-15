"use client";

/**
 * pnl-calendar widget — compact month grid(s) colored by daily net P&L
 * (semantic gain / loss tints), today ring, monthly net + legend in the header.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { toD } from "@/lib/trading/dec";
import { pnlClass } from "@/lib/format";
import { Money, Sensitive } from "@/components/privacy/money";
import { useFormat } from "@/lib/format/use-format";
import { pnlCalendarConfigSchema } from "@/lib/dashboard/registry";
import { asCalendarData, type CalendarCellDTO } from "./types";

function parseMonths(config: unknown): number {
  const parsed = pnlCalendarConfigSchema.safeParse(config ?? {});
  return parsed.success ? (parsed.data.months as number) : 1;
}

/** Local calendar day (YYYY-MM-DD) of now in `timezone`. */
function todayInTz(timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date())) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function cellTone(cell: CalendarCellDTO): string {
  if (!cell.inMonth) return "text-muted-foreground/40";
  if (cell.tradeCount === 0) return "text-muted-foreground";
  const pnl = toD(cell.netPnl);
  if (pnl.gt(0)) {
    return "bg-gain-subtle text-gain";
  }
  if (pnl.lt(0)) {
    return "bg-loss-subtle text-loss";
  }
  return "bg-muted text-muted-foreground";
}

export function PnlCalendarWidget({
  data,
  config,
  currency,
  timezone,
  locale,
}: {
  data: unknown;
  config: unknown;
  currency: string;
  timezone: string;
  locale: string;
}) {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const months = parseMonths(config);
  const calData = asCalendarData(data);
  const today = React.useMemo(() => todayInTz(timezone), [timezone]);

  /** Weekday header Mon..Sun from a stable reference week (Mon 2024-01-01). */
  const weekdayLabels = React.useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(locale, {
        weekday: "short",
        timeZone: "UTC",
      });
      return Array.from({ length: 7 }, (_, i) =>
        fmt.format(new Date(Date.UTC(2024, 0, 1 + i)))
      );
    } catch {
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    }
  }, [locale]);

  if (!calData || calData.months.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("equityEmpty")}</p>;
  }

  const monthLabel = (year: number, month: number) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, 15)));
    } catch {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  };

  return (
    <div className="space-y-4">
      {calData.months.slice(0, months).map((month) => (
        <section
          key={`${month.year}-${month.month}`}
          aria-label={monthLabel(month.year, month.month)}
          className="space-y-1.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium capitalize">
              {monthLabel(month.year, month.month)}
            </p>
            <p
              className={`text-xs font-semibold tabular-nums ${pnlClass(
                month.summary.netPnl
              )}`}
            >
              <Money signed value={month.summary.netPnl} currency={currency} />
            </p>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdayLabels.map((day) => (
              <p
                key={day}
                className="py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
              >
                {day}
              </p>
            ))}
            {month.grid.flat().map((cell) => {
              const isToday = cell.date === today;
              return (
                <div
                  key={cell.date}
                  className={`flex min-h-9 flex-col items-center justify-center rounded-md px-0.5 py-1 text-[10px] leading-tight ${cellTone(
                    cell
                  )} ${isToday ? "ring-2 ring-primary" : ""}`}
                  title={
                    cell.tradeCount > 0
                      ? `${cell.date} · ${fmt.signedMoney(cell.netPnl, currency)} · ${cell.tradeCount}`
                      : cell.date
                  }
                >
                  <span className="font-semibold tabular-nums">
                    {Number(cell.date.slice(8, 10))}
                  </span>
                  {cell.tradeCount > 0 ? (
                    <Sensitive kind="amount" className="tabular-nums">
                      {`${toD(cell.netPnl).gt(0) ? "+" : ""}${toD(
                        cell.netPnl
                      ).toNumber().toFixed(0)}`}
                    </Sensitive>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("calendarLegend", {
              green: month.summary.greenDays,
              red: month.summary.redDays,
            })}
          </p>
        </section>
      ))}
    </div>
  );
}
