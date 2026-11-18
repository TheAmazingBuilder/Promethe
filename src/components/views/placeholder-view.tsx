"use client";

import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface PlaceholderViewProps {
  /** Absolute message key, e.g. "nav.trades". */
  titleKey: string;
  /** Absolute message key, e.g. "nav.tradesDesc". */
  descriptionKey: string;
  icon: LucideIcon;
  phase: number;
  /** Absolute message keys, e.g. "placeholder.trades.liveCalc". */
  featureKeys: string[];
}

/** Generic "coming in phase N" view - keeps the roadmap visible in-app. */
export function PlaceholderView({
  titleKey,
  descriptionKey,
  icon: Icon,
  phase,
  featureKeys,
}: PlaceholderViewProps) {
  const t = useTranslations();

  return (
    <section aria-labelledby="placeholder-title">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:p-10">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          >
            <Icon className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <Badge variant="secondary" className="tabular-nums">
              {t("common.phase", { phase })}
            </Badge>
            <h2
              id="placeholder-title"
              className="text-2xl font-bold tracking-tight"
            >
              {t(titleKey)}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(descriptionKey)}
            </p>
          </div>
          {featureKeys.length > 0 && (
            <ul className="grid w-full gap-2 text-left sm:grid-cols-2">
              {featureKeys.map((featureKey) => (
                <li
                  key={featureKey}
                  className="flex items-start gap-2 rounded-md border p-2.5 text-sm text-muted-foreground"
                >
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                  {t(featureKey)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {t("placeholder.note", { phase })}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
