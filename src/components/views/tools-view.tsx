"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PositionSizeCalculator } from "@/components/tools/position-size-calculator";
import { PnlSimulator } from "@/components/tools/pnl-simulator";
import { InstrumentsBrowser } from "@/components/tools/instruments-browser";
import { MultiTpCalculator } from "@/components/tools/multi-tp-calculator";
import { MarginSimulator } from "@/components/tools/margin-simulator";
import { ExposureDashboard } from "@/components/tools/exposure-dashboard";
import { MarketHoursClock } from "@/components/tools/market-hours-clock";
import { CurrencyConverter } from "@/components/tools/currency-converter";
import { ExitPlansManager } from "@/components/tools/exit-plans-manager";
import { RiskRewardCalculator } from "@/components/tools/risk-reward-calculator";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { useRoute } from "@/lib/router";

const TAB_VALUES = [
  "sizing",
  "multi-tp",
  "pnl",
  "margin",
  "exposure",
  "market-hours",
  "converter",
  "exit-plans",
  "instruments",
  "risk-reward",
] as const;

type TabValue = (typeof TAB_VALUES)[number];

/** Tab from the route (/tools/margin or /tools?tab=margin); defaults to sizing. */
function tabFromQuery(tab: string | undefined): TabValue {
  return (TAB_VALUES as readonly string[]).includes(tab ?? "")
    ? (tab as TabValue)
    : "sizing";
}

/** Functional tools view - the decimal engines power the trade form (phase 3). */
export function ToolsView() {
  const t = useTranslations("tools");
  const route = useRoute();
  const [tab, setTab] = React.useState<TabValue>(() =>
    tabFromQuery(route.query?.tab)
  );

  // A deep link (or back/forward) re-selects the tab; clicking a tab stays
  // local, exactly like before.
  React.useEffect(() => {
    setTab(tabFromQuery(route.query?.tab));
  }, [route.query?.tab]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="sizing">{t("tabSizing")}</TabsTrigger>
          <TabsTrigger value="multi-tp">{t("tabMultiTp")}</TabsTrigger>
          <TabsTrigger value="pnl">{t("tabPnl")}</TabsTrigger>
          <TabsTrigger value="margin">{t("tabMargin")}</TabsTrigger>
          <TabsTrigger value="exposure">{t("tabExposure")}</TabsTrigger>
          <TabsTrigger value="market-hours">{t("tabMarketHours")}</TabsTrigger>
          <TabsTrigger value="converter">{t("tabConverter")}</TabsTrigger>
          <TabsTrigger value="exit-plans">{t("tabExitPlans")}</TabsTrigger>
          <TabsTrigger value="instruments">
            {t("tabInstruments")}
            <Badge
              variant="secondary"
              className="ml-1.5 hidden tabular-nums sm:inline-flex"
            >
              {PRESET_INSTRUMENTS.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="risk-reward">{t("tabRiskReward")}</TabsTrigger>
        </TabsList>

        <TabsContent value="sizing">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sizingTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("sizingDesc")}</p>
            </CardHeader>
            <CardContent>
              <PositionSizeCalculator />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="multi-tp">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("multiTpTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("multiTpDesc")}</p>
            </CardHeader>
            <CardContent>
              <MultiTpCalculator />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pnl">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("pnlTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("pnlDesc")}</p>
            </CardHeader>
            <CardContent>
              <PnlSimulator />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="margin">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("marginTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("marginDesc")}</p>
            </CardHeader>
            <CardContent>
              <MarginSimulator />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exposure">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("exposureTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("exposureDesc")}</p>
            </CardHeader>
            <CardContent>
              <ExposureDashboard />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="market-hours">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("marketHoursTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("marketHoursDesc")}</p>
            </CardHeader>
            <CardContent>
              <MarketHoursClock />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="converter">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("converterTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("converterDesc")}</p>
            </CardHeader>
            <CardContent>
              <CurrencyConverter />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exit-plans">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("exitPlansTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("exitPlansDesc")}</p>
            </CardHeader>
            <CardContent>
              <ExitPlansManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instruments">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("instrumentsTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("instrumentsDesc")}
              </p>
            </CardHeader>
            <CardContent>
              <InstrumentsBrowser />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk-reward">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("riskRewardTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("riskRewardDesc")}</p>
            </CardHeader>
            <CardContent>
              <RiskRewardCalculator />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
