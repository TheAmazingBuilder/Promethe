"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type LayoutSaveStatusValue = "idle" | "saving" | "saved" | "error";

/**
 * Visible layout save state (lot 12, roadmap §16). Autosave used to be
 * silent except for a screen-reader announcement and a failure toast:
 * the edit toolbar now shows Saving / Saved / Save failed next to Undo.
 * A stale-version conflict refetches silently (the hook handles it), so
 * "error" here means the save genuinely failed and the layout on screen
 * is the last known-good one.
 */
export function LayoutSaveStatus({
  status,
}: {
  status: LayoutSaveStatusValue;
}) {
  const t = useTranslations("dashboards.edit");
  if (status === "idle") return null;
  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {status === "saving" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : status === "saved" ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {status === "saving"
        ? t("saving")
        : status === "saved"
          ? t("layoutSaved")
          : t("saveFailed")}
    </span>
  );
}
