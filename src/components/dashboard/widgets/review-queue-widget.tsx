"use client";

/** review-queue widget - to-review / drafts counts with a CTA to the trades list. */
import { ArrowRight, ClipboardCheck, FileEdit } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fmtNum } from "@/lib/format";
import { navigate } from "@/lib/router";
import { asReviewQueueData } from "./types";

export function ReviewQueueWidget({ data }: { data: unknown }) {
  const t = useTranslations("dashboard");
  const queue = asReviewQueueData(data);
  const toReview = queue?.toReviewCount ?? 0;
  const drafts = queue?.draftCount ?? 0;

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <p className="text-sm font-semibold">{t("reviewQueue")}</p>
      <div className="space-y-1.5">
        <p
          className={`flex items-center gap-2 text-sm tabular-nums ${
            toReview > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          {t("toReview", { count: toReview })}
        </p>
        <p className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
          <FileEdit className="h-4 w-4" aria-hidden="true" />
          {t("draftsCount", { count: drafts })}
        </p>
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("#/trades")}
        >
          {t("goTrades")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <p className="sr-only">
        {fmtNum(toReview + drafts, 0)} {t("reviewQueue")}
      </p>
    </div>
  );
}
