"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  SHORTCUT_ACTIONS,
  effectiveKeys,
  formatChord,
} from "@/lib/shortcuts/registry";
import type { ShortcutDTO } from "@/lib/trading/dto";

/**
 * Cheat sheet (v2.5 Module 4 §4.1) - opened with "?" from anywhere.
 * Lists every registered shortcut with its effective chord.
 */
export function ShortcutHelpOverlay({
  open,
  onOpenChange,
  overrides,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overrides: ShortcutDTO[];
}) {
  const t = useTranslations("shortcutsView");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            {t("helpTitle")}
          </DialogTitle>
          <DialogDescription>{t("helpDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {SHORTCUT_ACTIONS.map((action) => (
            <div
              key={action.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(action.labelKey)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(action.descKey)}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 font-mono">
                {formatChord(effectiveKeys(action.id, overrides))}
              </Badge>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
