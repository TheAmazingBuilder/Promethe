"use client";

/**
 * Journal view (v1 phase 5) — one entry per local day: pre-market plan,
 * post-market review, mood/sleep/discipline scores (1-5), market bias and
 * key lesson. Deep-linkable (#/journal/{date}) from the calendar.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useCalendar,
  useDeleteJournalEntry,
  useJournalEntry,
  useSaveJournalEntry,
} from "@/hooks/use-journal";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { fmtDateInTz, pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { navigate } from "@/lib/router";
import { toD } from "@/lib/trading/dec";
import type { JournalEntryInput } from "@/lib/validations/journal";

const SCORES = [1, 2, 3, 4, 5] as const;

function shiftDay(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function todayIsoDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Star-less 1-5 score picker - buttons with an active state. */
function ScorePicker({
  label,
  value,
  onChange,
  noScoreLabel,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  noScoreLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {/* a11y (M8 Phase 5): wraps at 200 % text / narrow viewports (WCAG 1.4.10). */}
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className={[
              "h-8 w-8 rounded-md border text-sm font-semibold tabular-nums transition-colors",
              value === n
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
      {value == null ? (
        <span className="text-[10px] text-muted-foreground">{noScoreLabel}</span>
      ) : null}
    </div>
  );
}

export function JournalView({ date }: { date?: string }) {
  const t = useTranslations("journalView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const today = React.useMemo(() => todayIsoDay(), []);
  const day = date ?? today;

  const { data: entry, isLoading } = useJournalEntry(day);
  // Day P&L — reuses the calendar month payload (cached, shared with #/calendrier).
  const { data: calendarData } = useCalendar(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)),
  );
  const dayPnl = calendarData?.days?.[day] ?? null;
  const save = useSaveJournalEntry();
  const del = useDeleteJournalEntry();

  // Local form state — hydrated ONCE per day (server resolution first, so
  // an existing entry pre-fills the form; later refetches never clobber
  // in-progress edits).
  const [form, setForm] = React.useState<JournalEntryInput>({
    date: "",
    preMarketPlan: "",
    postMarketReview: "",
    mood: null,
    sleepQuality: null,
    disciplineScore: null,
    keyLesson: "",
    marketBias: "",
  });
  const [hydratedFor, setHydratedFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isLoading || hydratedFor === day) return;
    setForm({
      date: day,
      preMarketPlan: entry?.preMarketPlan ?? "",
      postMarketReview: entry?.postMarketReview ?? "",
      mood: entry?.mood ?? null,
      sleepQuality: entry?.sleepQuality ?? null,
      disciplineScore: entry?.disciplineScore ?? null,
      keyLesson: entry?.keyLesson ?? "",
      marketBias: entry?.marketBias ?? "",
    });
    setHydratedFor(day);
  }, [day, entry, isLoading, hydratedFor]);

  const set = <K extends keyof JournalEntryInput>(
    key: K,
    value: JournalEntryInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const dirty = React.useMemo(() => {
    if (entry == null) {
      return Boolean(
        form.preMarketPlan ||
          form.postMarketReview ||
          form.keyLesson ||
          form.marketBias ||
          form.mood != null ||
          form.sleepQuality != null ||
          form.disciplineScore != null,
      );
    }
    return (
      (form.preMarketPlan ?? "") !== (entry.preMarketPlan ?? "") ||
      (form.postMarketReview ?? "") !== (entry.postMarketReview ?? "") ||
      (form.keyLesson ?? "") !== (entry.keyLesson ?? "") ||
      (form.marketBias ?? "") !== (entry.marketBias ?? "") ||
      form.mood !== entry.mood ||
      form.sleepQuality !== entry.sleepQuality ||
      form.disciplineScore !== entry.disciplineScore
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
        mood: null,
        sleepQuality: null,
        disciplineScore: null,
        keyLesson: "",
        marketBias: "",
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

  return (
    <section
      aria-labelledby="journal-title"
      data-tour="journal"
      className="mx-auto flex max-w-4xl flex-col gap-6"
    >
      {/* Header + day navigation */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="journal-title" className="text-2xl font-bold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(`#/journal/${shiftDay(day, -1)}`)}
            aria-label={t("prevDay")}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Input
            type="date"
            value={day}
            onChange={(e) => {
              if (e.target.value) navigate(`#/journal/${e.target.value}`);
            }}
            aria-label={t("dateLabel")}
            className="w-[170px] font-mono tabular-nums"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(`#/journal/${shiftDay(day, 1)}`)}
            aria-label={t("nextDay")}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          {!isToday ? (
            <Button variant="outline" size="sm" onClick={() => navigate("#/journal")}>
              {t("today")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Scores + save bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("scores.title")}</CardTitle>
          <CardDescription>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              fmtDateInTz(`${day}T12:00:00Z`, "UTC")
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            <ScorePicker
              label={t("scores.mood")}
              value={form.mood ?? null}
              onChange={(v) => set("mood", v)}
              noScoreLabel={t("scores.noScore")}
            />
            <ScorePicker
              label={t("scores.sleepQuality")}
              value={form.sleepQuality ?? null}
              onChange={(v) => set("sleepQuality", v)}
              noScoreLabel={t("scores.noScore")}
            />
            <ScorePicker
              label={t("scores.disciplineScore")}
              value={form.disciplineScore ?? null}
              onChange={(v) => set("disciplineScore", v)}
              noScoreLabel={t("scores.noScore")}
            />
          </div>
          <div className="flex items-center gap-2">
            {entry != null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onDelete()}
                disabled={del.isPending}
                aria-label={t("delete")}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void onSave()} disabled={save.isPending || !dirty}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Day P&L */}
      {dayPnl && dayPnl.tradeCount > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-baseline justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("dayPnl.title")}
              </p>
              <p
                className={`text-xl font-bold tabular-nums ${pnlClass(dayPnl.netPnl)}`}
              >
                <Money
                  signed
                  value={dayPnl.netPnl}
                  currency={calendarData?.currency ?? "USD"}
                />
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p className="tabular-nums">
                {t("dayPnl.trades", { count: dayPnl.tradeCount })}
              </p>
              {dayPnl.totalR != null ? (
                <p className="tabular-nums">
                  {t("dayPnl.totalR", {
                    r: toD(dayPnl.totalR).toFixed(1),
                  })}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">{t("dayPnl.none")}</p>
      )}

      {/* Free-text fields */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("preMarketPlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.preMarketPlan ?? ""}
              onChange={(e) => set("preMarketPlan", e.target.value || null)}
              placeholder={t("preMarketHint")}
              rows={6}
              className="resize-y"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("postMarketReview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.postMarketReview ?? ""}
              onChange={(e) => set("postMarketReview", e.target.value || null)}
              placeholder={t("postMarketHint")}
              rows={6}
              className="resize-y"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("marketBias")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={form.marketBias ?? ""}
              onChange={(e) => set("marketBias", e.target.value || null)}
              placeholder={t("marketBiasHint")}
              maxLength={500}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("keyLesson")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={form.keyLesson ?? ""}
              onChange={(e) => set("keyLesson", e.target.value || null)}
              placeholder={t("keyLessonHint")}
              maxLength={2000}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
