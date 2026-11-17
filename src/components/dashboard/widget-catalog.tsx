"use client";

/**
 * Widget catalog — Sheet opened from edit mode. Search + category sections,
 * requirement-gated Add buttons, live N/24 counter. Adding uses the registry
 * default config and findFreeSlot for the lg layout.
 */
import * as React from "react";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAddWidget, type DashboardRequirements } from "@/hooks/use-dashboards";
import {
  getAllWidgetDefinitions,
  WIDGET_CATEGORY_KEYS,
  type WidgetDefinition,
  type WidgetRequirement,
} from "@/lib/dashboard/registry";
import {
  MAX_WIDGETS_PER_DASHBOARD,
  type DashboardDTO,
} from "@/lib/dashboard/types";
import { findFreeSlot } from "@/lib/dashboard/layout";
import { WidgetPreview } from "./widget-preview";
// Registers the v2.5 M2 chart widgets (saved-chart / heatmap / year-calendar)
// before the catalog lists definitions — idempotent side-effect import.
import "@/lib/dashboard/register-chart-widgets";

export function WidgetCatalog({
  open,
  onOpenChange,
  dashboard,
  requirements,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: DashboardDTO | null;
  requirements: DashboardRequirements | null;
  onAdded?: (name: string) => void;
}) {
  const t = useTranslations("dashboards");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const addWidget = useAddWidget();

  const widgetCount = dashboard?.widgets.length ?? 0;
  const full = widgetCount >= MAX_WIDGETS_PER_DASHBOARD;

  const definitions = React.useMemo(() => {
    const all = getAllWidgetDefinitions();
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((def) =>
      `${tRoot(def.nameKey)} ${tRoot(def.descriptionKey)}`
        .toLowerCase()
        .includes(needle)
    );
  }, [search, tRoot]);

  const requirementMet = React.useCallback(
    (req: WidgetRequirement) => requirements?.[req] !== false,
    [requirements]
  );

  const add = (def: WidgetDefinition) => {
    if (!dashboard || full) return;
    if (def.requires?.some((req) => !requirementMet(req))) return;
    const existingLg = dashboard.widgets
      .map((w) => w.layouts.lg)
      .filter((l): l is { x: number; y: number; w: number; h: number } => l != null);
    const slot = findFreeSlot(existingLg, def.defaultLayout.w, def.defaultLayout.h);
    addWidget.mutate(
      {
        dashboardId: dashboard.id,
        input: {
          type: def.type,
          config: def.defaultConfig,
          layouts: {
            lg: {
              x: slot.x,
              y: slot.y,
              w: def.defaultLayout.w,
              h: def.defaultLayout.h,
            },
          },
        },
      },
      {
        onSuccess: () => {
          onAdded?.(tRoot(def.nameKey));
          onOpenChange(false);
        },
        onError: (error) => {
          toast({
            title: t("catalog.addError"),
            description: (error as Error | undefined)?.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 pb-3">
          <SheetTitle>{t("catalog.title")}</SheetTitle>
          <SheetDescription>
            {t("catalog.counter", {
              count: widgetCount,
              max: MAX_WIDGETS_PER_DASHBOARD,
            })}
          </SheetDescription>
          <div className="relative pt-1">
            <Search
              className="absolute left-2.5 top-3.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("catalog.search")}
              className="pl-8"
              aria-label={t("catalog.search")}
            />
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="space-y-5 p-4">
            {full ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                {t("catalog.full")}
              </p>
            ) : null}
            {WIDGET_CATEGORY_KEYS.map((category) => {
              const items = definitions.filter((d) => d.category === category);
              if (items.length === 0) return null;
              return (
                <section key={category} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`categories.${category}`)}
                    <span className="ml-1.5 font-normal tabular-nums">
                      ({items.length})
                    </span>
                  </h3>
                  <ul className="space-y-2">
                    {items.map((def) => {
                      const unmet = def.requires?.filter(
                        (req) => !requirementMet(req)
                      );
                      const disabled = full || (unmet?.length ?? 0) > 0;
                      return (
                        <li
                          key={def.type}
                          className="rounded-lg border p-3"
                        >
                          <div className="flex items-start gap-3">
                            <def.icon
                              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">
                                {tRoot(def.nameKey)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {tRoot(def.descriptionKey)}
                              </p>
                              {unmet && unmet.length > 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground/80">
                                  {t("catalog.requires")}{" "}
                                  {unmet
                                    .map((req) => t(`requires.${req}`))
                                    .join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <Button
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              disabled={disabled}
                              onClick={() => add(def)}
                              aria-label={t("catalog.add", {
                                name: tRoot(def.nameKey),
                              })}
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                          <WidgetPreview
                            type={def.type}
                            className={disabled ? "mt-2 opacity-40" : "mt-2"}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {definitions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("catalog.empty")}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
