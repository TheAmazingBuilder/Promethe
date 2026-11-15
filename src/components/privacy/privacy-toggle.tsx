"use client";

/**
 * v2.5 Module 8 — One-click "Hide amounts" toggle (§3.1).
 *
 * Eye button in the top bar: cycles OFF → HIDE → OFF (blur lives in the
 * privacy settings). The active state is impossible to miss — the button
 * turns solid amber and a persistent "Amounts hidden" badge stays visible
 * next to it, so the user never forgets the mode is on. Also reachable via
 * the Shift+H shortcut (configurable) and the Cmd+K command palette.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePrivacyPreferences } from "./privacy-provider";
import { cn } from "@/lib/utils";

export function PrivacyToggle() {
  const t = useTranslations("privacy");
  const { preferences, setMode } = usePrivacyPreferences();
  const active = preferences.mode === "HIDE";

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={active}
            aria-label={active ? t("amountsHidden") : t("hideAmounts")}
            onClick={() => setMode(active ? "OFF" : "HIDE")}
            className={cn(
              "gap-1.5 text-muted-foreground",
              active &&
                "bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 hover:text-amber-800 dark:hover:text-amber-200"
            )}
          >
            {active ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
            {active && (
              <span className="hidden text-xs font-medium sm:inline">
                {t("amountsHidden")}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-medium">
            {active ? t("amountsHidden") : t("hideAmounts")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("toggleHint", { shortcut: preferences.shortcut.toUpperCase() })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
