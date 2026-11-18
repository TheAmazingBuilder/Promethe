"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useShortcuts } from "@/hooks/use-productivity";
import {
  effectiveKeys,
  isTypingTarget,
  matchesChord,
} from "@/lib/shortcuts/registry";
import { ROUTE_CHANGE_EVENT, navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";

/**
 * Floating "+" quick-trade button (mobile) + "Q" keyboard shortcut (v2 §4.1).
 * Hidden when a text input/textarea/select has focus so typing "q" is safe.
 * v2.5 Module 4 — the chord is reassignable via the shortcuts registry.
 */
export function QuickFab() {
  const t = useTranslations("quick");
  const [visible, setVisible] = React.useState(true);
  const shortcuts = useShortcuts();
  const overrides = shortcuts.data ?? [];

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesChord(e, effectiveKeys("quick-trade", overrides))) return;
      if (isTypingTarget(e.target)) return;
      if (window.location.pathname.startsWith("/trades/quick")) return;
      setVisible(false);
      navigate("/trades/quick");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overrides]);

  // Route-aware visibility: hidden on the quick form itself.
  React.useEffect(() => {
    const sync = () => {
      setVisible(!window.location.pathname.startsWith("/trades/quick"));
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  if (!visible) return null;

  return (
    <Button
      size="icon"
      aria-label={t("fab")}
      data-tour="quick-trade"
      // bottom-20 keeps the FAB clear of the sticky footer text on short pages.
      className="fixed bottom-20 right-5 z-40 h-14 w-14 rounded-full shadow-lg lg:hidden"
      onClick={() => navigate("/trades/quick")}
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </Button>
  );
}
