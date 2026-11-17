"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";

/**
 * Floating "+" quick-trade button (mobile) + "Q" keyboard shortcut (v2 §4.1).
 * Hidden when a text input/textarea/select has focus so typing "q" is safe.
 */
export function QuickFab() {
  const t = useTranslations("quick");
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "q" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];
      if (route.startsWith("trades/quick")) return;
      setVisible(false);
      navigate("#/trades/quick");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Route-aware visibility: hidden on the quick form itself.
  React.useEffect(() => {
    const sync = () => {
      const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];
      setVisible(!route.startsWith("trades/quick"));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  if (!visible) return null;

  return (
    <Button
      size="icon"
      aria-label={t("fab")}
      data-tour="quick-trade"
      // bottom-20 keeps the FAB clear of the sticky footer text on short pages.
      className="fixed bottom-20 right-5 z-40 h-14 w-14 rounded-full shadow-lg lg:hidden"
      onClick={() => navigate("#/trades/quick")}
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </Button>
  );
}
