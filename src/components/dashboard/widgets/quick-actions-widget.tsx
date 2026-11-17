"use client";

/** quick-actions widget - ported QuickActionsCard + new trade shortcuts. */
import { ArrowRight, Calculator, LayoutTemplate, Plus, Settings, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";

export function QuickActionsWidget() {
  const t = useTranslations("dashboard");
  const shortcuts = [
    { label: t("quickTools"), icon: Calculator, href: "#/outils" },
    { label: t("quickTemplates"), icon: LayoutTemplate, href: "#/reglages/templates" },
    { label: t("quickSettings"), icon: Settings, href: "#/reglages" },
  ];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button onClick={() => navigate("#/trades/new")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("emptyCtaForm")}
        </Button>
        <Button variant="outline" onClick={() => navigate("#/trades/quick")}>
          <Zap className="h-4 w-4" aria-hidden="true" />
          {t("emptyCtaQuick")}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {shortcuts.map(({ label, icon: Icon, href }) => (
          <Button
            key={href}
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            onClick={() => navigate(href)}
          >
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ))}
      </div>
    </div>
  );
}
