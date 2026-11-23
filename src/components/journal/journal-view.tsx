"use client";

/**
 * Journal — a focused trading-day workspace.
 * Keeps the existing JournalEntry contract and API mutations unchanged.
 */
import * as React from "react";
import Image from "next/image";
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Moon,
  Save,
  Sparkles,
  Sun,
  Target,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/ui/query-error-state";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCalendar,
  useCalendarDay,
  useDeleteJournalEntry,
  useJournalEntry,
  useRecentJournal,
  useSaveJournalEntry,
} from "@/hooks/use-journal";
import { JournalPeriodReviewPanel } from "./journal-period-review";
import { JournalTemplateControls } from "./journal-template-controls";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { fmtDateInTz, pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { navigate } from "@/lib/router";
import { toD } from "@/lib/trading/dec";
import { useTimePrefs } from "@/components/time/time-provider";
import type { JournalEntryInput } from "@/lib/validations/journal";

const SCORES = [1, 2, 3, 4, 5] as const;

const SCORE_LABELS: Record<"mood" | "sleep" | "discipline", string[]> = {
  mood: ["Low", "Uneven", "Balanced", "Good", "Great"],
  sleep: ["Restless", "Light", "Fair", "Good", "Rested"],
  discipline: ["Off-plan", "Weak", "Mixed", "Focused", "Excellent"],
};

function shiftDay(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function ScorePicker({
  label,
  value,
  onChange,
  noScoreLabel,
  kind,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  noScoreLabel: string;
  kind: keyof typeof SCORE_LABELS;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  const selectedLabel = value == null ? noScoreLabel : SCORE_LABELS[kind][value - 1];

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{selectedLabel}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={label}>
        {SCORES.map((score) => {
          const active = value === score;
          return (
            <button
              key={score}
              type="button"
              aria-label={`${label}: ${SCORE_LABELS[kind][score - 1]}`}
              aria-pressed={active}
              onClick={() => onChange(active ? null : score)}
              className={[
                "h-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border/70 bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {score}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScalePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{value == null ? "Not rated" : `${value}/5`}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={label}>
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${label}: ${score} of 5`}
            aria-pressed={value === score}
            onClick={() => onChange(value === score ? null : score)}
            className={[
              "h-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              value === score
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border/70 bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="mt-0.5 text-base font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function JournalView({ date }: { date?: string }) {
  const t = useTranslations("journalView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { tradingDayOf, loaded: timeLoaded } = useTimePrefs();
  const today = React.useMemo(
    () => tradingDayOf(),
    [tradingDayOf, timeLoaded]
  );
  const day = date ?? today;

  const {
    data: entry,
    isLoading,
    isError,
    refetch,
  } = useJournalEntry(day);
  const { data: calendarData } = useCalendar(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)),
  );
  const [historySearchInput, setHistorySearchInput] = React.useState("");
  const [historyQuery, setHistoryQuery] = React.useState("");
  const [historyFrom, setHistoryFrom] = React.useState("");
  const [historyTo, setHistoryTo] = React.useState("");
  const [historyMood, setHistoryMood] = React.useState("");
  const [historyDiscipline, setHistoryDiscipline] = React.useState("");
  const { data: recentEntries = [], isLoading: recentLoading } = useRecentJournal({
    q: historyQuery || undefined,
    from: historyFrom || undefined,
    to: historyTo || undefined,
    mood: historyMood ? Number(historyMood) : undefined,
    discipline: historyDiscipline ? Number(historyDiscipline) : undefined,
    limit: 50,
  });
  const dayPnl = calendarData?.days?.[day] ?? null;
  const {
    data: dayActivity,
    isLoading: tradesLoading,
    isError: tradesError,
    refetch: refetchTrades,
  } = useCalendarDay(day);
  const save = useSaveJournalEntry();
  const del = useDeleteJournalEntry();

  const [form, setForm] = React.useState<JournalEntryInput>({
    date: "",
    preMarketPlan: "",
    postMarketReview: "",
    keyLevels: "",
    primaryScenario: "",
    alternateScenario: "",
    invalidationConditions: "",
    maxRiskPercent: null,
    mood: null,
    sleepQuality: null,
    disciplineScore: null,
    stressLevel: null,
    energyLevel: null,
    focusLevel: null,
    keyLesson: "",
    marketBias: "",
    nextSessionCommitment: "",
  });
  const [hydratedFor, setHydratedFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isLoading || hydratedFor === day) return;
    setForm({
      date: day,
      preMarketPlan: entry?.preMarketPlan ?? "",
      postMarketReview: entry?.postMarketReview ?? "",
      keyLevels: entry?.keyLevels ?? "",
      primaryScenario: entry?.primaryScenario ?? "",
      alternateScenario: entry?.alternateScenario ?? "",
      invalidationConditions: entry?.invalidationConditions ?? "",
      maxRiskPercent: entry?.maxRiskPercent ?? null,
      mood: entry?.mood ?? null,
      sleepQuality: entry?.sleepQuality ?? null,
      disciplineScore: entry?.disciplineScore ?? null,
      stressLevel: entry?.stressLevel ?? null,
      energyLevel: entry?.energyLevel ?? null,
      focusLevel: entry?.focusLevel ?? null,
      keyLesson: entry?.keyLesson ?? "",
      marketBias: entry?.marketBias ?? "",
      nextSessionCommitment: entry?.nextSessionCommitment ?? "",
    });
    setHydratedFor(day);
  }, [day, entry, isLoading, hydratedFor]);

  const set = <K extends keyof JournalEntryInput>(
    key: K,
    value: JournalEntryInput[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const dirty = React.useMemo(() => {
    if (entry == null) {
      return Boolean(
        form.preMarketPlan ||
          form.postMarketReview ||
          form.keyLesson ||
          form.marketBias ||
          form.keyLevels ||
          form.primaryScenario ||
          form.alternateScenario ||
          form.invalidationConditions ||
          form.maxRiskPercent ||
          form.nextSessionCommitment ||
          form.mood != null ||
          form.sleepQuality != null ||
          form.disciplineScore != null ||
          form.stressLevel != null ||
          form.energyLevel != null ||
          form.focusLevel != null,
      );
    }
    return (
      (form.preMarketPlan ?? "") !== (entry.preMarketPlan ?? "") ||
      (form.postMarketReview ?? "") !== (entry.postMarketReview ?? "") ||
      (form.keyLesson ?? "") !== (entry.keyLesson ?? "") ||
      (form.marketBias ?? "") !== (entry.marketBias ?? "") ||
      (form.keyLevels ?? "") !== (entry.keyLevels ?? "") ||
      (form.primaryScenario ?? "") !== (entry.primaryScenario ?? "") ||
      (form.alternateScenario ?? "") !== (entry.alternateScenario ?? "") ||
      (form.invalidationConditions ?? "") !== (entry.invalidationConditions ?? "") ||
      (form.maxRiskPercent ?? "") !== (entry.maxRiskPercent ?? "") ||
      (form.nextSessionCommitment ?? "") !== (entry.nextSessionCommitment ?? "") ||
      form.mood !== entry.mood ||
      form.sleepQuality !== entry.sleepQuality ||
      form.disciplineScore !== entry.disciplineScore ||
      form.stressLevel !== entry.stressLevel ||
      form.energyLevel !== entry.energyLevel ||
      form.focusLevel !== entry.focusLevel
    );
  }, [form, entry]);

  const onSave = async () => {
    try {
      await save.mutateAsync(form);
      toast({ title: t("saved") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    }
  };

  const onDelete = async () => {
    if (!window.confirm(t("deleteConfirm", { date: day }))) return;
    try {
      await del.mutateAsync(day);
      setForm({
        date: day,
        preMarketPlan: "",
        postMarketReview: "",
        keyLevels: "",
        primaryScenario: "",
        alternateScenario: "",
        invalidationConditions: "",
        maxRiskPercent: null,
        mood: null,
        sleepQuality: null,
        disciplineScore: null,
        stressLevel: null,
        energyLevel: null,
        focusLevel: null,
        keyLesson: "",
        marketBias: "",
        nextSessionCommitment: "",
      });
      toast({ title: t("deleted") });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    }
  };

  const isToday = day === today;
  const completedSections = [
    Boolean(form.preMarketPlan?.trim()),
    Boolean(form.keyLevels?.trim() || form.primaryScenario?.trim() || form.alternateScenario?.trim()),
    form.maxRiskPercent != null && form.maxRiskPercent !== "",
    form.mood != null && form.sleepQuality != null && form.disciplineScore != null,
    form.stressLevel != null && form.energyLevel != null && form.focusLevel != null,
    Boolean(form.postMarketReview?.trim()),
    Boolean(form.keyLesson?.trim()),
    Boolean(form.nextSessionCommitment?.trim()),
  ].filter(Boolean).length;
  const completion = Math.round((completedSections / 8) * 100);

  return (
    <section
      aria-labelledby="journal-title"
      data-tour="journal"
      className="flex flex-col gap-5"
    >
      <PageHeader
        id="journal-title"
        title={t("title")}
        description={t("subtitle")}
        className="flex-wrap gap-y-3 sm:items-end"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => navigate(`/journal/${shiftDay(day, -1)}`)}
              aria-label={t("prevDay")}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <DateField
              id="journal-day"
              ariaLabel={t("dateLabel")}
              className="h-9 w-[170px]"
              value={day}
              onChange={(value) => {
                if (value) navigate(`/journal/${value}`);
              }}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => navigate(`/journal/${shiftDay(day, 1)}`)}
              aria-label={t("nextDay")}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            {!isToday ? (
              <Button variant="secondary" size="sm" onClick={() => navigate("/journal")}>
                {t("today")}
              </Button>
            ) : null}
          </div>
        }
      />

      {isError ? (
        <QueryErrorState
          title="Journal entry could not be loaded"
          description="Your saved journal data is safe. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/40 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {isToday ? t("today") : "Trading day"}
                    </Badge>
                    {entry ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                        Saved entry
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">New journal entry</span>
                    )}
                  </div>
                  <h2 className="text-base font-semibold tracking-tight">
                    {isLoading ? <Skeleton className="h-7 w-48" /> : fmtDateInTz(`${day}T12:00:00Z`, "UTC")}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry?.updatedAt
                      ? `Last saved ${fmtDateInTz(entry.updatedAt, "UTC")}`
                      : "Capture the decisions behind today's trades."}
                  </p>
                </div>
                <div className="flex min-w-[180px] flex-col gap-2 sm:items-end">
                  <div className="flex w-full items-center justify-between gap-3 sm:justify-end">
                    <span className="text-[11px] text-muted-foreground">Journal completion</span>
                    <span className="text-xs font-semibold tabular-nums">{completion}%</span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-44"
                    role="progressbar"
                    aria-label="Journal completion"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={completion}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${completion}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {dirty ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Unsaved changes
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                        Up to date
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Target className="h-3.5 w-3.5" aria-hidden="true" />
                    Day result
                  </div>
                  {dayPnl && dayPnl.tradeCount > 0 ? (
                    <div className={`mt-1 text-lg font-semibold tabular-nums ${pnlClass(dayPnl.netPnl)}`}>
                      <Money signed value={dayPnl.netPnl} currency={calendarData?.currency ?? "USD"} />
                    </div>
                  ) : (
                    <p className="mt-1 text-sm font-medium text-muted-foreground">—</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{t("dayPnl.title")}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    Closed trades
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {dayPnl?.tradeCount ?? 0}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {dayPnl?.tradeCount ? t("dayPnl.trades", { count: dayPnl.tradeCount }) : t("dayPnl.none")}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {dayPnl?.totalR != null && Number(dayPnl.totalR) > 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : dayPnl?.totalR != null && Number(dayPnl.totalR) < 0 ? (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Net performance
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {dayPnl?.totalR != null ? `${toD(dayPnl.totalR).toFixed(1)}R` : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Total R multiple</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Trading activity</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Closed trades attributed to this trading day. Open positions remain in the Trades workspace.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {dayActivity?.tradeCount ?? dayPnl?.tradeCount ?? 0} trades
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {tradesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : tradesError ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-4">
                  <p className="text-sm text-muted-foreground">Trading activity could not be loaded.</p>
                  <Button variant="outline" size="sm" onClick={() => void refetchTrades()}>Retry</Button>
                </div>
              ) : (dayActivity?.trades.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  No closed trades recorded for this trading day.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {dayActivity?.trades.map((trade) => (
                    <button
                      key={trade.id}
                      type="button"
                      onClick={() => navigate(`/trades/${trade.id}`)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg px-2.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{trade.symbol}</span>
                        <Badge variant="outline" className={trade.direction === "LONG" ? "border-gain/30 text-gain" : "border-loss/30 text-loss"}>
                          {trade.direction === "LONG" ? "BUY" : "SELL"}
                        </Badge>
                        <span className="max-w-[220px] truncate text-xs text-muted-foreground">
                          {trade.strategyName ?? trade.setupType ?? "No strategy"}
                        </span>
                        <Badge variant={trade.reviewStatus === "REVIEWED" ? "secondary" : "outline"}>
                          {trade.reviewStatus === "REVIEWED" ? "Reviewed" : "Review pending"}
                        </Badge>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {trade.rMultiple != null ? `${toD(trade.rMultiple).toFixed(2)}R` : "—"}
                        </span>
                        <Money signed value={trade.netPnl} currency={trade.pnlCurrency} className={`text-sm font-semibold tabular-nums ${pnlClass(trade.netPnl)}`} />
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plan vs execution</CardTitle>
              <CardDescription className="mt-1 text-xs">
                Compare what you intended to do with the trades actually closed during this trading day.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0 md:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
                <Badge variant="outline">Planned</Badge>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Market bias</p>
                  <p className="mt-1 text-sm font-medium">{form.marketBias || "No market bias recorded"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary scenario</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{form.primaryScenario || form.preMarketPlan || "No scenario recorded"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Maximum planned risk</p>
                  <p className="mt-1 text-sm font-medium">{form.maxRiskPercent ? `${form.maxRiskPercent}%` : "Not specified"}</p>
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
                <Badge variant="outline">Actual</Badge>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Closed trades</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{dayActivity?.tradeCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Win / loss</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{dayActivity?.wins ?? 0} / {dayActivity?.losses ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net P&amp;L</p>
                    <Money signed value={dayActivity?.netPnl ?? null} currency={dayActivity?.currency ?? "USD"} className="mt-1 block text-lg font-semibold tabular-nums" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total R</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{dayActivity?.totalR ?? "—"}</p>
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground md:col-span-2">
                Use the post-market reflection below to explain whether you followed the plan, what changed, and why. Trade-level adherence remains documented in Trade Review.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Chart gallery</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Private chart screenshots already attached to this day&apos;s trades.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {dayActivity?.screenshots?.length ?? 0} charts
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {(dayActivity?.screenshots?.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  No chart screenshots attached to this day&apos;s trades yet.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dayActivity?.screenshots?.map((screenshot) => (
                    <a
                      key={screenshot.id}
                      href={`/api/v1/uploads/${screenshot.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-xl border border-border/70 bg-muted/20 transition-colors hover:border-primary/40"
                    >
                      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                        <Image
                          src={`/api/v1/uploads/${screenshot.id}`}
                          alt={`${screenshot.symbol} chart screenshot`}
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{screenshot.symbol}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {screenshot.caption ?? screenshot.label ?? "Trade screenshot"}
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Behavioral patterns</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Mistakes already tagged in Trade Review for this day&apos;s closed trades.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {(dayActivity?.behavioralMistakes ?? []).reduce((total, item) => total + item.count, 0)} tags
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {(dayActivity?.behavioralMistakes?.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  No mistake tags recorded in Trade Review for this day.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {dayActivity?.behavioralMistakes?.map((mistake) => (
                    <Badge key={mistake.id} variant="outline" className="gap-2 rounded-lg px-3 py-2">
                      <span>{mistake.name}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{mistake.count}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("scores.title")}</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Your condition shapes your decisions. Track it consistently.
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  1–5 scale
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-0 md:grid-cols-3">
              <ScorePicker
                label={t("scores.mood")}
                value={form.mood ?? null}
                onChange={(value) => set("mood", value)}
                noScoreLabel={t("scores.noScore")}
                kind="mood"
                icon={Sun}
              />
              <ScorePicker
                label={t("scores.sleepQuality")}
                value={form.sleepQuality ?? null}
                onChange={(value) => set("sleepQuality", value)}
                noScoreLabel={t("scores.noScore")}
                kind="sleep"
                icon={Moon}
              />
              <ScorePicker
                label={t("scores.disciplineScore")}
                value={form.disciplineScore ?? null}
                onChange={(value) => set("disciplineScore", value)}
                noScoreLabel={t("scores.noScore")}
                kind="discipline"
                icon={Target}
              />
              <ScalePicker label="Stress" value={form.stressLevel ?? null} onChange={(value) => set("stressLevel", value)} />
              <ScalePicker label="Energy" value={form.energyLevel ?? null} onChange={(value) => set("energyLevel", value)} />
              <ScalePicker label="Focus" value={form.focusLevel ?? null} onChange={(value) => set("focusLevel", value)} />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Execution plan</CardTitle>
              <CardDescription className="text-xs">Turn your market view into scenarios, invalidation rules and a defined risk limit.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="journal-key-levels" className="text-sm font-medium">Key levels</label>
                <Textarea id="journal-key-levels" value={form.keyLevels ?? ""} onChange={(event) => set("keyLevels", event.target.value || null)} placeholder="Support, resistance, liquidity zones..." rows={3} maxLength={4000} />
              </div>
              <div className="space-y-2">
                <label htmlFor="journal-primary-scenario" className="text-sm font-medium">Primary scenario</label>
                <Textarea id="journal-primary-scenario" value={form.primaryScenario ?? ""} onChange={(event) => set("primaryScenario", event.target.value || null)} placeholder="What needs to happen for your preferred setup?" rows={3} maxLength={4000} />
              </div>
              <div className="space-y-2">
                <label htmlFor="journal-alternate-scenario" className="text-sm font-medium">Alternative scenario</label>
                <Textarea id="journal-alternate-scenario" value={form.alternateScenario ?? ""} onChange={(event) => set("alternateScenario", event.target.value || null)} placeholder="What is your plan if the main scenario fails?" rows={3} maxLength={4000} />
              </div>
              <div className="space-y-2">
                <label htmlFor="journal-invalidation" className="text-sm font-medium">Invalidation conditions</label>
                <Textarea id="journal-invalidation" value={form.invalidationConditions ?? ""} onChange={(event) => set("invalidationConditions", event.target.value || null)} placeholder="What would make you stop looking for this setup?" rows={3} maxLength={4000} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="journal-max-risk" className="text-sm font-medium">Maximum planned risk (%)</label>
                <Input id="journal-max-risk" inputMode="decimal" value={form.maxRiskPercent ?? ""} onChange={(event) => set("maxRiskPercent", event.target.value || null)} placeholder="e.g. 1" maxLength={6} className="h-10 max-w-40" />
                <p className="text-xs text-muted-foreground">Set a daily ceiling before trading. This does not change account or trade risk settings.</p>
              </div>
            </CardContent>
          </Card>

          <JournalTemplateControls
            values={{
              marketBias: form.marketBias,
              preMarketPlan: form.preMarketPlan,
              keyLevels: form.keyLevels,
              primaryScenario: form.primaryScenario,
              alternateScenario: form.alternateScenario,
              invalidationConditions: form.invalidationConditions,
              maxRiskPercent: form.maxRiskPercent,
            }}
            onApply={(template) => {
              set("marketBias", template.marketBias ?? "");
              set("preMarketPlan", template.preMarketPlan ?? "");
              set("keyLevels", template.keyLevels ?? "");
              set("primaryScenario", template.primaryScenario ?? "");
              set("alternateScenario", template.alternateScenario ?? "");
              set("invalidationConditions", template.invalidationConditions ?? "");
              set("maxRiskPercent", template.maxRiskPercent ?? null);
            }}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <SectionHeading
                  icon={Sun}
                  eyebrow="Before the session"
                  title={t("preMarketPlan")}
                  description="Define the context and the decisions you want to make before the market opens."
                />
                <Textarea
                  value={form.preMarketPlan ?? ""}
                  onChange={(event) => set("preMarketPlan", event.target.value || null)}
                  placeholder={t("preMarketHint")}
                  rows={9}
                  className="min-h-52 resize-y border-border/70 bg-muted/20 text-sm leading-relaxed focus-visible:bg-background"
                />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Write your bias, important levels, scenarios and invalidation conditions.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <SectionHeading
                  icon={Clock3}
                  eyebrow="After the session"
                  title={t("postMarketReview")}
                  description="Review what actually happened and how well you executed your plan."
                />
                <Textarea
                  value={form.postMarketReview ?? ""}
                  onChange={(event) => set("postMarketReview", event.target.value || null)}
                  placeholder={t("postMarketHint")}
                  rows={9}
                  className="min-h-52 resize-y border-border/70 bg-muted/20 text-sm leading-relaxed focus-visible:bg-background"
                />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Separate market conditions, execution quality and emotional decisions.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <SectionHeading
                  icon={Compass}
                  eyebrow="Market context"
                  title={t("marketBias")}
                  description="What was your directional view for this trading day?"
                />
                <Input
                  value={form.marketBias ?? ""}
                  onChange={(event) => set("marketBias", event.target.value || null)}
                  placeholder={t("marketBiasHint")}
                  maxLength={500}
                  className="h-10 border-border/70 bg-muted/20 focus-visible:bg-background"
                />
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <SectionHeading
                  icon={Sparkles}
                  eyebrow="Takeaway"
                  title={t("keyLesson")}
                  description="Keep one clear lesson that can improve your next trading session."
                />
                <Input
                  value={form.keyLesson ?? ""}
                  onChange={(event) => set("keyLesson", event.target.value || null)}
                  placeholder={t("keyLessonHint")}
                  maxLength={2000}
                  className="h-10 border-border/70 bg-muted/20 focus-visible:bg-background"
                />
                <div className="mt-4 space-y-2">
                  <label htmlFor="journal-next-commitment" className="text-sm font-medium">Next-session commitment</label>
                  <Textarea id="journal-next-commitment" value={form.nextSessionCommitment ?? ""} onChange={(event) => set("nextSessionCommitment", event.target.value || null)} placeholder="One specific behavior you will apply next session..." rows={3} maxLength={2000} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg shadow-background/30 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {dirty ? (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span>Changes are not saved yet</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  <span>{entry ? "Your journal is up to date" : "Start writing to create this entry"}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {entry != null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void onDelete()}
                  disabled={del.isPending}
                  aria-label={t("delete")}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("delete")}</span>
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void onSave()} disabled={save.isPending || !dirty}>
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {save.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          </div>

          <JournalPeriodReviewPanel selectedDay={day} />

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-base">{t("recent.title")}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Your latest trading-day notes.
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                {recentEntries.length}
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto_auto]">
                <Input
                  value={historySearchInput}
                  onChange={(event) => setHistorySearchInput(event.target.value)}
                  placeholder="Search plans, levels, lessons and market bias..."
                  className="h-10"
                  maxLength={120}
                  aria-label="Search Journal history"
                />
                <Input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} aria-label="From date" className="h-10" />
                <Input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} aria-label="To date" className="h-10" />
                <select
                  value={historyMood}
                  onChange={(event) => setHistoryMood(event.target.value)}
                  aria-label="Filter by mood"
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Any mood</option>
                  {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>Mood {score}/5</option>)}
                </select>
                <select
                  value={historyDiscipline}
                  onChange={(event) => setHistoryDiscipline(event.target.value)}
                  aria-label="Filter by discipline"
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Any discipline</option>
                  {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>Discipline {score}/5</option>)}
                </select>
                <Button
                  size="sm"
                  onClick={() => setHistoryQuery(historySearchInput.trim())}
                  disabled={Boolean(historyFrom && historyTo && historyFrom > historyTo)}
                >
                  Search
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setHistorySearchInput("");
                    setHistoryQuery("");
                    setHistoryFrom("");
                    setHistoryTo("");
                    setHistoryMood("");
                    setHistoryDiscipline("");
                  }}
                >
                  Clear
                </Button>
              </div>
              {historyFrom && historyTo && historyFrom > historyTo ? (
                <p className="mb-3 text-xs text-destructive">The start date must be before the end date.</p>
              ) : null}
              {recentLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : recentEntries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  {historyQuery || historyFrom || historyTo || historyMood || historyDiscipline
                    ? "No Journal entries match these filters."
                    : t("recent.empty")}
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {recentEntries.slice(0, 10).map((recent) => {
                    const isCurrent = recent.date === day;
                    const summary =
                      recent.keyLesson?.trim() ||
                      recent.primaryScenario?.trim() ||
                      recent.keyLevels?.trim() ||
                      recent.marketBias?.trim() ||
                      recent.preMarketPlan?.trim() ||
                      recent.postMarketReview?.trim() ||
                      t("untitled");
                    return (
                      <button
                        key={recent.id}
                        type="button"
                        onClick={() => navigate(`/journal/${recent.date}`)}
                        aria-current={isCurrent ? "date" : undefined}
                        className={[
                          "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-3 text-left transition-colors",
                          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isCurrent ? "bg-muted/50" : "",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {fmtDateInTz(`${recent.date}T12:00:00Z`, "UTC")}
                            </span>
                            {isCurrent ? <Badge variant="secondary" className="text-[9px]">Current</Badge> : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
