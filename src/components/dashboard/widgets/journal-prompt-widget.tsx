"use client";

/** journal-prompt widget - daily prompt + "Open journal" CTA + entry check. */
import { BookOpen, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { asJournalPromptData } from "./types";

export function JournalPromptWidget({ data }: { data: unknown }) {
  const t = useTranslations("dashboards");
  const promptData = asJournalPromptData(data);
  const prompt = promptData?.prompt;

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <blockquote className="text-sm italic text-muted-foreground">
        {prompt ? `“${prompt}”` : t("journalPromptEmpty")}
      </blockquote>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => navigate("#/journal")}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t("journalPromptOpen")}
        </Button>
        {promptData?.hasEntryToday ? (
          <span
            className="flex items-center gap-1 text-xs text-gain"
            aria-live="polite"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("journalPromptDone")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
