/**
 * v2.5 Module 5 (c) - non-blocking pre-trade exposure check in the trade
 * form. Warns (never blocks) when the new position increases an already
 * concentrated currency or duplicates a currency held on other open
 * positions, or when no stop-loss is set. Hidden while the form is
 * incomplete; silent when there is nothing to flag.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info } from "lucide-react";
import { useInstruments, useTradesList } from "@/hooks/use-trading";
import { checkPreTrade, type OpenTradeLike } from "@/lib/tools/exposure";
import { DEFAULT_EXPOSURE_SETTINGS } from "@/lib/tools/types";
import { useExposureSettings, useFxRates } from "@/hooks/use-tools";
import { PRESET_INSTRUMENTS, findPreset } from "@/lib/trading/instruments";

export function PreTradeExposureCheck({
  symbol,
  direction,
  lots,
  entryPrice,
  stopLoss,
  accountBalance,
  accountCurrency,
  excludeTradeId,
}: {
  symbol: string;
  direction: string;
  lots: string;
  entryPrice: string;
  stopLoss: string;
  accountBalance: string;
  accountCurrency: string;
  excludeTradeId?: string | null;
}) {
  const t = useTranslations("tools");
  // Server settings; on error (tables missing, offline) the check falls
  // back to the defaults and no stored rates — it stays advisory only.
  const settingsQuery = useExposureSettings();
  const settings = settingsQuery.data ?? DEFAULT_EXPOSURE_SETTINGS;
  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];
  const { data: instruments } = useInstruments();
  const openTrades = useTradesList({
    page: 1,
    pageSize: 100,
    sort: "entryTime",
    order: "desc",
    includeDrafts: false,
    status: "OPEN",
  });

  const ready =
    symbol !== "" && lots.trim() !== "" && entryPrice.trim() !== "" && Number(lots) > 0;

  const warnings = React.useMemo(() => {
    if (!ready || openTrades.isLoading || !openTrades.data) return [];
    const fxInputs = fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate }));
    const others: OpenTradeLike[] = openTrades.data.data
      .filter((item) => item.id !== excludeTradeId)
      .map((item) => ({
        id: item.id,
        symbol: item.symbol,
        direction: item.direction,
        lots: item.lots,
        entryPrice: item.entryPrice,
        stopLoss: item.stopLoss,
        strategyName: item.strategyName,
        accountCurrency,
      }));
    const contractSizeFor = (sym: string): string => {
      const dbInstrument = (instruments ?? []).find((i) => i.symbol === sym);
      return (
        dbInstrument?.contractSize ??
        findPreset(sym)?.contractSize ??
        PRESET_INSTRUMENTS.find((i) => i.symbol === sym)?.contractSize ??
        "100000"
      );
    };
    const candidate: OpenTradeLike = {
      id: "candidate",
      symbol,
      direction,
      lots,
      entryPrice,
      stopLoss: stopLoss.trim() === "" ? null : stopLoss,
      accountCurrency,
    };
    return checkPreTrade(
      candidate,
      others,
      accountBalance === "" ? "0" : accountBalance,
      accountCurrency,
      contractSizeFor,
      settings,
      fxInputs
    );
  }, [ready, openTrades.isLoading, openTrades.data, fxRates, symbol, direction, lots, entryPrice, stopLoss, accountBalance, accountCurrency, excludeTradeId, instruments, settings]);

  if (!ready || warnings.length === 0) return null;
  return (
    <div className="space-y-2" role="status">
      {warnings.map((w, i) => (
        <p
          key={`${w.messageKey}-${i}`}
          className={
            w.level === "warning"
              ? "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs font-medium text-amber-600 dark:text-amber-400"
              : "flex items-start gap-2 rounded-md border p-2 text-xs text-muted-foreground"
          }
        >
          {w.level === "warning" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {t(`preTrade_${w.messageKey}`, { detail: w.detail, currency: w.currency ?? "" })}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">{t("preTradeNonBlocking")}</p>
    </div>
  );
}
