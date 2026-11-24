"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/ui/query-error-state";
import {
  useJournalPeriodReview,
  useSaveJournalPeriodReview,
} from "@/hooks/use-journal";
import type { JournalPeriodType } from "@/hooks/use-journal";

type FormState = {
  whatWentWell: string;
  whatToImprove: string;
  keyLesson: string;
  nextCommitment: string;
};

const EMPTY: FormState = {
  whatWentWell: "",
  whatToImprove: "",
  keyLesson: "",
  nextCommitment: "",
};

function getPeriodRange(day: string, type: JournalPeriodType) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (type === "WEEKLY") {
    const offset = (date.getUTCDay() + 6) % 7;
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - offset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function JournalPeriodReviewPanel({
  selectedDay,
  onDirtyChange,
}: {
  selectedDay: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [periodType, setPeriodType] = React.useState<JournalPeriodType>("WEEKLY");
  const range = React.useMemo(() => getPeriodRange(selectedDay, periodType), [selectedDay, periodType]);
  const { data: review, isLoading, isError, refetch } = useJournalPeriodReview(periodType, range.start);
  const save = useSaveJournalPeriodReview();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [status, setStatus] = React.useState("");
  const drafts = React.useRef<Record<string, FormState>>({});
  const [dirtyPeriods, setDirtyPeriods] = React.useState<Record<string, boolean>>({});
  const [hydratedPeriodKey, setHydratedPeriodKey] = React.useState<string | null>(null);
  const periodKey = `${periodType}:${range.start}`;

  React.useEffect(() => {
    setForm(drafts.current[periodKey] ?? {
      whatWentWell: review?.whatWentWell ?? "",
      whatToImprove: review?.whatToImprove ?? "",
      keyLesson: review?.keyLesson ?? "",
      nextCommitment: review?.nextCommitment ?? "",
    });
    setHydratedPeriodKey(periodKey);
    setStatus("");
  }, [periodKey, review?.id, review?.updatedAt]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    const next = { ...form, [key]: value };
    const nextIsDirty =
      next.whatWentWell !== (review?.whatWentWell ?? "") ||
      next.whatToImprove !== (review?.whatToImprove ?? "") ||
      next.keyLesson !== (review?.keyLesson ?? "") ||
      next.nextCommitment !== (review?.nextCommitment ?? "");

    setForm(next);
    if (nextIsDirty) {
      drafts.current[periodKey] = next;
    } else {
      delete drafts.current[periodKey];
    }
    setDirtyPeriods((current) => ({ ...current, [periodKey]: nextIsDirty }));
  };
  const dirty = hydratedPeriodKey === periodKey && (
    form.whatWentWell !== (review?.whatWentWell ?? "") ||
    form.whatToImprove !== (review?.whatToImprove ?? "") ||
    form.keyLesson !== (review?.keyLesson ?? "") ||
    form.nextCommitment !== (review?.nextCommitment ?? "")
  );

  const hasUnsavedDrafts = Object.values(dirtyPeriods).some(Boolean);

  React.useEffect(() => {
    onDirtyChange(dirty || hasUnsavedDrafts);
  }, [dirty, dirtyPeriods, hasUnsavedDrafts, onDirtyChange]);

  React.useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        periodType,
        periodStart: range.start,
        periodEnd: range.end,
        ...form,
      });
      delete drafts.current[periodKey];
      setDirtyPeriods((current) => ({ ...current, [periodKey]: false }));
      setStatus("Review saved.");
    } catch {
      setStatus("Could not save this review. Please try again.");
    }
  };

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Weekly & monthly reflection</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Qualitative review only. Performance statistics and weekly action plans remain in Analytics.
            </CardDescription>
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-1">
            <Button size="sm" variant={periodType === "WEEKLY" ? "default" : "ghost"} onClick={() => setPeriodType("WEEKLY")}>Weekly</Button>
            <Button size="sm" variant={periodType === "MONTHLY" ? "default" : "ghost"} onClick={() => setPeriodType("MONTHLY")}>Monthly</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline">{periodType === "WEEKLY" ? "Week" : "Month"}</Badge>
          <span className="text-xs tabular-nums text-muted-foreground">{range.start} — {range.end}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2" aria-label="Loading period review">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState
            title="Period review could not be loaded"
            description="Your saved reflection has not been changed. Try loading this period again."
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="journal-period-wins">What went well?</label>
                <Textarea id="journal-period-wins" rows={3} maxLength={4000} value={form.whatWentWell} onChange={(event) => set("whatWentWell", event.target.value)} placeholder="Behaviors, decisions and routines worth repeating…" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="journal-period-improve">What should improve?</label>
                <Textarea id="journal-period-improve" rows={3} maxLength={4000} value={form.whatToImprove} onChange={(event) => set("whatToImprove", event.target.value)} placeholder="Patterns or decisions to correct next period…" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="journal-period-lesson">Most important lesson</label>
                <Textarea id="journal-period-lesson" rows={3} maxLength={3000} value={form.keyLesson} onChange={(event) => set("keyLesson", event.target.value)} placeholder="The one lesson you want to remember…" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="journal-period-commitment">Commitment for the next period</label>
                <Textarea id="journal-period-commitment" rows={3} maxLength={2000} value={form.nextCommitment} onChange={(event) => set("nextCommitment", event.target.value)} placeholder="A concrete behavior you will apply…" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">{status || (review ? "Saved review" : "No review saved for this period yet")}</p>
              <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || save.isPending}>
                {save.isPending ? "Saving…" : "Save review"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
