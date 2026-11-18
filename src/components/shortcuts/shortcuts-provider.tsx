"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ShortcutHelpOverlay } from "./shortcut-help-overlay";
import { useShortcuts, undoLatestGroup } from "@/hooks/use-productivity";
import {
  effectiveKeys,
  isTypingTarget,
  matchesChord,
} from "@/lib/shortcuts/registry";
import { navigate } from "@/lib/router";
import { useToast } from "@/hooks/use-toast";

/**
 * Global shortcut dispatcher (v2.5 Module 4 §4.1).
 *
 * Owns only the NEW global actions: "?" cheat sheet, mod+z undo of the
 * latest change group, mod+shift+f jump to search. The pre-existing
 * handlers (palette mod+k, focus f, quick trade q, privacy shift+h)
 * stay where they are but now read their effective chord from the same
 * registry - see app-shell.tsx and quick-fab.tsx.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [helpOpen, setHelpOpen] = React.useState(false);
  const shortcuts = useShortcuts();
  const { toast } = useToast();
  const t = useTranslations("shortcutsView");
  const overrides = shortcuts.data ?? [];

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // An overlay is open - only "?" gets through (it toggles the help).
      if (document.querySelector("[data-state=open]") != null) {
        if (!matchesChord(event, effectiveKeys("shortcuts-help", overrides))) {
          return;
        }
      }
      if (matchesChord(event, effectiveKeys("shortcuts-help", overrides))) {
        event.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (matchesChord(event, effectiveKeys("go-search", overrides))) {
        event.preventDefault();
        navigate("/search");
        return;
      }
      if (matchesChord(event, effectiveKeys("undo-last-change", overrides))) {
        event.preventDefault();
        void undoLatestGroup()
          .then((res) => {
            if (res) {
              toast({ title: t("undoneToast", { count: res.restored }) });
            } else {
              toast({ title: t("nothingToUndo") });
            }
          })
          .catch(() => {
            toast({ title: t("undoFailed"), variant: "destructive" });
          });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overrides, toast, t]);

  return (
    <>
      {children}
      <ShortcutHelpOverlay
        open={helpOpen}
        onOpenChange={setHelpOpen}
        overrides={overrides}
      />
    </>
  );
}
