"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PositionSizeCalculator } from "@/components/tools/position-size-calculator";
import { PnlSimulator } from "@/components/tools/pnl-simulator";
import { InstrumentsBrowser } from "@/components/tools/instruments-browser";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { Badge } from "@/components/ui/badge";

/** Functional tools view - the decimal engines power the trade form (phase 3). */
export function ToolsView() {
  const t = useTranslations("tools");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs defaultValue="sizing" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="sizing">{t("tabSizing")}</TabsTrigger>
          <TabsTrigger value="pnl">{t("tabPnl")}</TabsTrigger>
          <TabsTrigger value="instruments">
            {t("tabInstruments")}
            <Badge
              variant="secondary"
              className="ml-1.5 hidden tabular-nums sm:inline-flex"
            >
              {PRESET_INSTRUMENTS.length}
            </Badge>
          </TabsTrigger>
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
      </Tabs>
    </div>
  );
}
