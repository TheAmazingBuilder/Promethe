"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Link2, Pencil, RefreshCw, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DateField } from "@/components/ui/date-field";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/components/app/session-context";
import { fmtDateInTz, fmtDateTimeInTz } from "@/lib/format";
import { zonedParts } from "@/lib/time/zones";
import { EVENT_STALE_AFTER_MS, zonedTimeToUtc } from "@/lib/economic-calendar/providers";
import {
  useCreateManualEvent,
  useDeleteManualEvent,
  useEconomicCalendarEvent,
  useEconomicCalendarEvents,
  useEconomicCalendarSources,
  useLinkEventToTrade,
  useSyncEconomicCalendar,
  useUnlinkEventFromTrade,
  useUpdateManualEvent,
  useUpdateWatchlistPrefs,
  useWatchlistPrefs,
  type EconomicCalendarSourceDTO,
  type EconomicEventDTO,
} from "@/hooks/use-economic-calendar";
import type { EconomicCalendarSyncReport } from "@/server/economic-calendar";
import { useTradesList } from "@/hooks/use-trading";
import type { ManualEconomicEventInput } from "@/lib/validations/economic-calendar";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"];
const CATEGORIES = ["NFP", "CPI", "FOMC", "PPI", "GDP", "PMI", "RETAIL_SALES", "RATE_DECISION", "SPEECH", "OTHER"];
const IMPACTS = ["HIGH", "MEDIUM", "LOW", "UNRATED"] as const;

type Period = "today" | "week" | "month" | "all";

function localDateParts(timezone: string): { year: number; month: number; day: number } {
  const parts = zonedParts(new Date(), timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateString(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" in the profile timezone (form value). */
function isoToProfileInput(iso: string, timezone: string): string {
  const parts = zonedParts(new Date(iso), timezone);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" in the profile timezone -> UTC ISO. Null when invalid. */
function profileInputToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return zonedTimeToUtc(
    `${year}-${month}-${day}`,
    Number(hour),
    Number(minute),
    timezone,
  ).toISOString();
}

function periodRange(period: Period, timezone: string): { from: string | null; to: string | null } {
  const { year, month, day } = localDateParts(timezone);
  const today = dateString(year, month, day);
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const weekday = zonedParts(new Date(), timezone).weekday; // 0 = Sunday
    const mondayOffset = (weekday + 6) % 7;
    const monday = shiftDate(today, -mondayOffset);
    return { from: monday, to: shiftDate(monday, 6) };
  }
  if (period === "month") {
    const first = dateString(year, month, 1);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: first, to: dateString(year, month, lastDay) };
  }
  return { from: null, to: null };
}

function impactBadgeVariant(impact: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (impact === "HIGH") return "destructive";
  if (impact === "MEDIUM") return "default";
  if (impact === "LOW") return "secondary";
  return "outline";
}

function sourceLabel(source: string): string {
  if (source === "FOREXFACTORY") return "ForexFactory";
  if (source === "FRED") return "FRED";
  return "Manual";
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "OK") return "default";
  if (status === "STALE") return "secondary";
  if (status === "DOWN") return "destructive";
  return "outline";
}

function isStale(event: EconomicEventDTO, now: number): boolean {
  if (event.source === "MANUAL") return false;
  if (!event.sourceUpdatedAt) return true;
  return now - new Date(event.sourceUpdatedAt).getTime() > EVENT_STALE_AFTER_MS;
}

export function EconomicCalendarView() {
  const t = useTranslations("economicCalendar");
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";

  const [period, setPeriod] = React.useState<Period>("week");
  const [currencies, setCurrencies] = React.useState<string[]>([]);
  const [impacts, setImpacts] = React.useState<string[]>([]);
  const [category, setCategory] = React.useState<string>("all");
  const [source, setSource] = React.useState<string>("all");
  const [watchlistOnly, setWatchlistOnly] = React.useState(false);
  const [openEventId, setOpenEventId] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EconomicEventDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<EconomicEventDTO | null>(null);

  const range = periodRange(period, timezone);
  const queryFrom = range.from ? shiftDate(range.from, -1) : undefined;
  const queryTo = range.to ? shiftDate(range.to, 1) : undefined;

  const eventsQuery = useEconomicCalendarEvents({
    from: queryFrom,
    to: queryTo,
    currencies: currencies.length > 0 ? currencies : undefined,
    impacts: impacts.length > 0 ? impacts : undefined,
    categories: category !== "all" ? [category] : undefined,
    sources: source !== "all" ? [source] : undefined,
    watchlistOnly,
  });
  const sourcesQuery = useEconomicCalendarSources();
  const sync = useSyncEconomicCalendar();

  const events = React.useMemo(() => {
    const all = eventsQuery.data?.events ?? [];
    const from = range.from;
    const to = range.to;
    if (!from || !to) return all;
    // The query window is widened by a day for timezone offsets; keep
    // only the events whose local day falls inside the chosen period.
    return all.filter((event) => {
      const parts = zonedParts(new Date(event.scheduledAt), timezone);
      const localDay = dateString(parts.year, parts.month, parts.day);
      return localDay >= from && localDay <= to;
    });
  }, [eventsQuery.data, range.from, range.to, timezone]);

  const grouped = React.useMemo(() => {
    const groups = new Map<string, EconomicEventDTO[]>();
    for (const event of events) {
      const parts = zonedParts(new Date(event.scheduledAt), timezone);
      const day = dateString(parts.year, parts.month, parts.day);
      const list = groups.get(day) ?? [];
      list.push(event);
      groups.set(day, list);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events, timezone]);

  const sources: EconomicCalendarSourceDTO[] = sourcesQuery.data?.sources ?? [];
  const fred = sources.find((item) => item.source === "FRED");
  const report = sync.data?.report;
  const now = Date.now();

  const toggleInList = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("desc")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("addEvent")}
            </Button>
            <Button onClick={() => sync.mutate(false)} disabled={sync.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {sync.isPending ? t("refreshing") : t("refresh")}
            </Button>
          </>
        }
      />

      <SourcesCard
        sources={sources}
        timezone={timezone}
        report={report}
        fredNotConfigured={fred != null && !fred.configured}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("currencies")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["today", "week", "month", "all"] as Period[]).map((value) => (
              <Button
                key={value}
                variant={period === value ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod(value)}
              >
                {t(
                  value === "today"
                    ? "periodToday"
                    : value === "week"
                      ? "periodWeek"
                      : value === "month"
                        ? "periodMonth"
                        : "periodAll",
                )}
              </Button>
            ))}
            <label className="ml-2 flex items-center gap-2 text-sm">
              <Switch checked={watchlistOnly} onCheckedChange={setWatchlistOnly} />
              {t("watchlistOnly")}
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t("currencies")}</p>
            <div className="flex flex-wrap gap-3">
              {CURRENCIES.map((currency) => (
                <label key={currency} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={currencies.includes(currency)}
                    onCheckedChange={() => setCurrencies(toggleInList(currencies, currency))}
                  />
                  {currency}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t("importance")}</p>
            <div className="flex flex-wrap gap-3">
              {IMPACTS.map((impact) => (
                <label key={impact} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={impacts.includes(impact)}
                    onCheckedChange={() => setImpacts(toggleInList(impacts, impact))}
                  />
                  {t(
                    impact === "HIGH"
                      ? "impactHigh"
                      : impact === "MEDIUM"
                        ? "impactMedium"
                        : impact === "LOW"
                          ? "impactLow"
                          : "impactUnrated",
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="w-48 space-y-2">
              <Label>{t("category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  {CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48 space-y-2">
              <Label>{t("source")}</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  <SelectItem value="FRED">FRED</SelectItem>
                  <SelectItem value="FOREXFACTORY">ForexFactory</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {eventsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t("refreshing")}</p>
      ) : eventsQuery.isError ? (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm text-muted-foreground">{t("loadError")}</p>
            <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()}>
              {t("retry")}
            </Button>
          </CardContent>
        </Card>
      ) : events.length === 0 ? (
        <EmptyState title={t("empty")} description={t("methodMerge")} />
      ) : (
        grouped.map(([day, dayEvents]) => (
          <section key={day} aria-label={day} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {fmtDateInTz(`${day}T12:00:00.000Z`, "UTC")}
            </h2>
            <div className="space-y-2">
              {dayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  timezone={timezone}
                  now={now}
                  open={openEventId === event.id}
                  onToggle={() => setOpenEventId(openEventId === event.id ? null : event.id)}
                  onEdit={() => {
                    setEditing(event);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(event)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <WatchlistCard />
      <MethodCard />

      {formOpen ? (
        <ManualEventForm
          timezone={timezone}
          editing={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteEvent")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDelete")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <DeleteConfirmButton
              event={deleteTarget}
              onDone={() => setDeleteTarget(null)}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SourcesCard({
  sources,
  timezone,
  report,
  fredNotConfigured,
}: {
  sources: EconomicCalendarSourceDTO[];
  timezone: string;
  report: EconomicCalendarSyncReport | undefined;
  fredNotConfigured: boolean;
}) {
  const t = useTranslations("economicCalendar");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sourcesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("neverSynced")}</p>
        ) : (
          sources.map((item) => (
            <div key={item.source} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{sourceLabel(item.source)}</span>
              <Badge variant={statusBadgeVariant(item.status)}>
                {t(
                  item.status === "OK"
                    ? "statusOk"
                    : item.status === "STALE"
                      ? "statusStale"
                      : item.status === "DOWN"
                        ? "statusDown"
                        : "statusNotConfigured",
                )}
              </Badge>
              <span className="text-muted-foreground">
                {item.lastSyncAt
                  ? t("lastSync", { time: fmtDateTimeInTz(item.lastSyncAt, timezone) })
                  : t("neverSynced")}
              </span>
              {item.eventCount > 0 ? (
                <span className="text-muted-foreground">
                  {t("eventsTouched", { count: item.eventCount })}
                </span>
              ) : null}
              {item.lastError ? (
                <span className="text-muted-foreground">{item.lastError}</span>
              ) : null}
            </div>
          ))
        )}
        {fredNotConfigured ? (
          <p className="text-sm text-muted-foreground">{t("fredNotConfigured")}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">{t("ffUnofficial")}</p>
        {report ? (
          <p className="text-sm text-muted-foreground">
            {report.sources
              .map((entry) => `${sourceLabel(entry.source)}: ${entry.status} (${entry.fetched})`)
              .join(" · ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  timezone,
  now,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  event: EconomicEventDTO;
  timezone: string;
  now: number;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("economicCalendar");
  const stale = isStale(event, now);
  return (
    <Card>
      <CardContent className="pt-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full flex-wrap items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {fmtDateTimeInTz(event.scheduledAt, timezone)}
          </span>
          <span className="text-sm font-medium">{event.title}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {event.currency}
          </Badge>
          <Badge variant={impactBadgeVariant(event.impact)} className="text-[10px]">
            {event.impact == null
              ? t("impactUnrated")
              : t(
                  event.impact === "HIGH"
                    ? "impactHigh"
                    : event.impact === "MEDIUM"
                      ? "impactMedium"
                      : "impactLow",
                )}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {sourceLabel(event.source)}
          </Badge>
          {stale ? (
            <Badge variant="secondary" className="text-[10px]">
              {t("stale")}
            </Badge>
          ) : null}
          <span className="ml-auto flex gap-4 text-sm tabular-nums">
            <Value label={t("actual")} value={event.actual} fallback={t("notReleased")} />
            <Value label={t("forecast")} value={event.forecast} fallback={t("notAvailable")} />
            <Value label={t("previous")} value={event.previous} fallback={t("notAvailable")} />
          </span>
        </button>
        {open ? (
          <EventDetail event={event} timezone={timezone} onEdit={onEdit} onDelete={onDelete} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Value({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? fallback}</span>
    </span>
  );
}

function EventDetail({
  event,
  timezone,
  onEdit,
  onDelete,
}: {
  event: EconomicEventDTO;
  timezone: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("economicCalendar");
  const detail = useEconomicCalendarEvent(event.id);
  const link = useLinkEventToTrade();
  const unlink = useUnlinkEventFromTrade();
  const [tradeId, setTradeId] = React.useState("");
  const tradesQuery = useTradesList({
    page: 1,
    pageSize: 20,
    sort: "entryTime",
    order: "desc",
    includeDrafts: false,
  });
  const trades = tradesQuery.data?.data ?? [];
  const linked = detail.data?.trades ?? [];

  return (
    <div className="mt-4 space-y-3 border-t pt-4 text-sm">
      <div className="flex flex-wrap gap-2 text-muted-foreground">
        <span>
          {t("category")}: {event.category}
        </span>
        <span>
          {t("updated")}:{" "}
          {event.sourceUpdatedAt ? fmtDateTimeInTz(event.sourceUpdatedAt, timezone) : t("neverSynced")}
        </span>
      </div>
      {event.isManual ? (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t("editEvent")}
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t("deleteEvent")}
          </Button>
        </div>
      ) : null}
      <div>
        <p className="mb-2 font-medium">{t("linkedTrades")}</p>
        {linked.length === 0 ? (
          <p className="text-muted-foreground">{t("noLinkedTrades")}</p>
        ) : (
          <ul className="space-y-1">
            {linked.map((item) => (
              <li key={item.tradeId} className="flex items-center gap-2">
                <span className="font-mono text-xs">{item.tradeId.slice(0, 8)}</span>
                <Badge variant="outline" className="text-[10px]">
                  {t(
                    item.phase === "BEFORE"
                      ? "phaseBefore"
                      : item.phase === "DURING"
                        ? "phaseDuring"
                        : "phaseAfter",
                  )}
                </Badge>
                <span className="text-muted-foreground">
                  {item.offsetMinutes} min{item.autoLinked ? " · auto" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => unlink.mutate({ tradeId: item.tradeId, eventId: event.id })}
                >
                  <Unlink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {t("unlink")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={tradeId} onValueChange={setTradeId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t("selectTrade")} />
            </SelectTrigger>
            <SelectContent>
              {trades.map((trade) => (
                <SelectItem key={trade.id} value={trade.id}>
                  {trade.symbol} · {fmtDateTimeInTz(trade.entryTime, timezone)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!tradeId || link.isPending}
            onClick={() => {
              link.mutate({ tradeId, eventId: event.id });
              setTradeId("");
            }}
          >
            <Link2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t("linkToTrade")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ManualEventForm({
  timezone,
  editing,
  onClose,
}: {
  timezone: string;
  editing: EconomicEventDTO | null;
  onClose: () => void;
}) {
  const t = useTranslations("economicCalendar");
  const create = useCreateManualEvent();
  const update = useUpdateManualEvent();
  const [title, setTitle] = React.useState(editing?.title ?? "");
  const [currency, setCurrency] = React.useState(editing?.currency ?? "USD");
  const [country, setCountry] = React.useState(editing?.country ?? "");
  const [category, setCategory] = React.useState(editing?.category ?? "OTHER");
  const [impact, setImpact] = React.useState<string>(editing?.impact ?? "MEDIUM");
  const [when, setWhen] = React.useState(
    editing ? isoToProfileInput(editing.scheduledAt, timezone) : "",
  );
  const [actual, setActual] = React.useState(editing?.actual ?? "");
  const [forecast, setForecast] = React.useState(editing?.forecast ?? "");
  const [previous, setPrevious] = React.useState(editing?.previous ?? "");
  const [unit, setUnit] = React.useState(editing?.unit ?? "");
  const [error, setError] = React.useState<string | null>(null);

  const pending = create.isPending || update.isPending;

  const submit = () => {
    const iso = profileInputToIso(when, timezone);
    if (!title.trim() || !iso) {
      setError(t("createFailed"));
      return;
    }
    const input: ManualEconomicEventInput = {
      title: title.trim(),
      currency: currency.trim().toUpperCase(),
      country: country.trim() ? country.trim().toUpperCase() : undefined,
      impact: impact as "LOW" | "MEDIUM" | "HIGH",
      category: category as ManualEconomicEventInput["category"],
      scheduledAt: iso,
      actual: actual.trim() ? actual.trim() : undefined,
      forecast: forecast.trim() ? forecast.trim() : undefined,
      previous: previous.trim() ? previous.trim() : undefined,
      unit: unit.trim() ? unit.trim() : undefined,
    };
    const done = () => onClose();
    const failed = () => setError(t("createFailed"));
    if (editing) {
      update.mutate({ id: editing.id, input }, { onSuccess: done, onError: failed });
    } else {
      create.mutate(input, { onSuccess: done, onError: failed });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t("editEvent") : t("addEvent")}</CardTitle>
        <CardDescription>{t("methodManual")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="eco-title">{t("eventTitle")}</Label>
            <Input id="eco-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eco-currency">{t("eventCurrency")}</Label>
            <Input
              id="eco-currency"
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eco-country">{t("eventCountry")}</Label>
            <Input
              id="eco-country"
              value={country}
              maxLength={3}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("eventCategory")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("eventImpact")}</Label>
            <Select value={impact} onValueChange={setImpact}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">{t("impactHigh")}</SelectItem>
                <SelectItem value="MEDIUM">{t("impactMedium")}</SelectItem>
                <SelectItem value="LOW">{t("impactLow")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DateField
            id="eco-when"
            type="datetime-local"
            label={t("eventWhen")}
            value={when}
            onChange={setWhen}
          />
          <div className="space-y-2">
            <Label htmlFor="eco-actual">{t("eventActual")}</Label>
            <Input id="eco-actual" value={actual} onChange={(e) => setActual(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eco-forecast">{t("eventForecast")}</Label>
            <Input id="eco-forecast" value={forecast} onChange={(e) => setForecast(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eco-previous">{t("eventPrevious")}</Label>
            <Input id="eco-previous" value={previous} onChange={(e) => setPrevious(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eco-unit">{t("eventUnit")}</Label>
            <Input id="eco-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-xs text-muted-foreground">
          {t("eventWhen")} · {timezone}
        </p>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending}>
            {t("save")}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WatchlistCard() {
  const t = useTranslations("economicCalendar");
  const prefsQuery = useWatchlistPrefs();
  const save = useUpdateWatchlistPrefs();
  const prefs = prefsQuery.data?.prefs;
  const [currencies, setCurrencies] = React.useState<string[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [minImpact, setMinImpact] = React.useState("MEDIUM");
  const [alertsEnabled, setAlertsEnabled] = React.useState(true);
  const [alertMinutesBefore, setAlertMinutesBefore] = React.useState(60);
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (prefs && !initialized) {
      setCurrencies(prefs.currencies);
      setCategories(prefs.categories);
      setMinImpact(prefs.minImpact);
      setAlertsEnabled(prefs.alertsEnabled);
      setAlertMinutesBefore(prefs.alertMinutesBefore);
      setInitialized(true);
    }
  }, [prefs, initialized]);

  const toggleInList = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("watchlistTitle")}</CardTitle>
        <CardDescription>{t("watchlistDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">{t("currencies")}</p>
          <div className="flex flex-wrap gap-3">
            {CURRENCIES.map((currency) => (
              <label key={currency} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={currencies.includes(currency)}
                  onCheckedChange={() => setCurrencies(toggleInList(currencies, currency))}
                />
                {currency}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t("category")}</p>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES.map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={categories.includes(value)}
                  onCheckedChange={() => setCategories(toggleInList(categories, value))}
                />
                {value}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48 space-y-2">
            <Label>{t("importance")}</Label>
            <Select value={minImpact} onValueChange={setMinImpact}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">{t("impactLow")}</SelectItem>
                <SelectItem value="MEDIUM">{t("impactMedium")}</SelectItem>
                <SelectItem value="HIGH">{t("impactHigh")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={alertsEnabled} onCheckedChange={setAlertsEnabled} />
            {t("alertsEnabled")}
          </label>
          <div className="w-40 space-y-2">
            <Label htmlFor="eco-alert-minutes">{t("alertMinutesBefore")}</Label>
            <Input
              id="eco-alert-minutes"
              type="number"
              min={5}
              max={1440}
              value={alertMinutesBefore}
              onChange={(e) => setAlertMinutesBefore(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                currencies,
                categories: categories as Array<
                  "NFP" | "CPI" | "FOMC" | "PPI" | "GDP" | "PMI" | "RETAIL_SALES" | "RATE_DECISION" | "SPEECH" | "OTHER"
                >,
                minImpact: minImpact as "LOW" | "MEDIUM" | "HIGH",
                alertsEnabled,
                alertMinutesBefore,
              })
            }
          >
            {t("savePrefs")}
          </Button>
          {save.isSuccess ? <span className="text-sm text-muted-foreground">{t("prefsSaved")}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MethodCard() {
  const t = useTranslations("economicCalendar");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("methodTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>{t("methodFred")}</p>
        <p>{t("methodFf")}</p>
        <p>{t("methodManual")}</p>
        <p>{t("methodMerge")}</p>
        <p>{t("methodStale")}</p>
      </CardContent>
    </Card>
  );
}

function DeleteConfirmButton({
  event,
  onDone,
}: {
  event: EconomicEventDTO | null;
  onDone: () => void;
}) {
  const t = useTranslations("economicCalendar");
  const remove = useDeleteManualEvent();
  return (
    <AlertDialogAction
      disabled={!event || remove.isPending}
      onClick={() => {
        if (!event) return;
        remove.mutate(event.id, { onSuccess: onDone });
      }}
    >
      {t("deleteEvent")}
    </AlertDialogAction>
  );
}
