"use client";

/**
 * Shared shell for the advanced analytics tabs (v2.5 Module 6).
 *
 * Header (back link, title, description, sample size) + period/account
 * filters + tab navigation + loading / error / empty states. Each tab view
 * fetches its data with useAdvancedAnalytics and renders its own content
 * as children.
 */
import * as React from "react";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sensitive } from "@/components/privacy/money";
import { useSession } from "@/components/app/session-context";
import { useAccounts } from "@/hooks/use-trading";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";
import { navigate } from "@/lib/router";

export type AdvancedTabId =
  | "lifecycle"
  | "exits"
  | "quality"
  | "setups"
  | "sequences"
  | "seasonality"
  | "anomalies";

export const ADVANCED_TABS: Array<{ id: AdvancedTabId; path: string }> = [
  { id: "lifecycle", path: "/analytics/lifecycle" },
  { id: "exits", path: "/analytics/exits" },
  { id: "quality", path: "/analytics/quality" },
  { id: "setups", path: "/analytics/setups" },
  { id: "sequences", path: "/analytics/sequences" },
  { id: "seasonality", path: "/analytics/seasonality" },
  { id: "anomalies", path: "/analytics/anomalies" },
];

const PERIODS: AnalyticsPeriod[] = ["30d", "90d", "ytd", "all"];

interface AdvancedShellProps {
  tab: AdvancedTabId;
  title: string;
  description: string;
  period: AnalyticsPeriod;
  onPeriodChange: (p: AnalyticsPeriod) => void;
  accountId: string;
  onAccountChange: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** True when the period holds zero closed trades. */
  empty: boolean;
  sampleCount: number | null;
  children: React.ReactNode;
}

export function AdvancedShell({
  tab,
  title,
  description,
  period,
  onPeriodChange,
  accountId,
  onAccountChange,
  isLoading,
  isError,
  onRetry,
  empty,
  sampleCount,
  children,
}: AdvancedShellProps) {
  const { session } = useSession();
  const t = useTranslations("analytics.advanced");
  const tAnalytics = useTranslations("analytics");
  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];

  if (!session) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0"
          onClick={() => navigate("/analytics")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("backToAnalytics")}
        </Button>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
          {sampleCount != null ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("sample", { count: sampleCount })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={period}
            onValueChange={(v) => {
              if (v && PERIODS.includes(v as AnalyticsPeriod)) {
                onPeriodChange(v as AnalyticsPeriod);
              }
            }}
          >
            <ToggleGroupItem value="30d">
              {tAnalytics("period30d")}
            </ToggleGroupItem>
            <ToggleGroupItem value="90d">
              {tAnalytics("period90d")}
            </ToggleGroupItem>
            <ToggleGroupItem value="ytd">
              {tAnalytics("periodYtd")}
            </ToggleGroupItem>
            <ToggleGroupItem value="all">
              {tAnalytics("periodAll")}
            </ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={accountId}
            onValueChange={(v) => onAccountChange(v === "all" ? "all" : v)}
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={tAnalytics("accountFilter")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {tAnalytics("allAccounts")}
              </SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <Sensitive kind="account">{a.name}</Sensitive>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Tab navigation (segmented ToggleGroup, same a11y pattern as the
            analytics period switcher: a tabset without panels dangles
            aria-controls, so navigation buttons are used instead of Tabs). */}
        <div className="flex flex-wrap gap-2">
          {ADVANCED_TABS.map((item) => (
            <Button
              key={item.id}
              variant={item.id === tab ? "default" : "outline"}
              size="sm"
              onClick={() => navigate(item.path)}
            >
              {t(`tabs.${item.id}`)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6" role="status" aria-live="polite">
          <span className="sr-only">{t("loading")}</span>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">{t("errorTitle")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t("errorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : empty ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          </CardContent>
        </Card>
      ) : (
        children
      )}
    </div>
  );
}
