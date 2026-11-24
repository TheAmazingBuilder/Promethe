/**
 * v2.5 Module 5 (c) - currency exposure dashboard.
 *
 * Open trades are decomposed into currency legs, aggregated per currency,
 * instrument and strategy, with duplication alerts and no-SL flags. The
 * current price of each open trade can be edited here: it drives the
 * floating P&L estimate and the leg notionals (saved on Trade.currentPrice
 * through the trade API).
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts, useInstruments, useTradesList, useUpdateTrade } from "@/hooks/use-trading";
import {
  aggregateExposure,
  decomposeTrade,
  detectDuplication,
  type OpenTradeLike,
} from "@/lib/tools/exposure";
import { DEFAULT_EXPOSURE_SETTINGS } from "@/lib/tools/types";
import {
  isToolsTablesMissing,
  useExposureSettings,
  useFxRates,
  useSaveExposureSettings,
} from "@/hooks/use-tools";
import { PRESET_INSTRUMENTS, findPreset } from "@/lib/trading/instruments";
import { fmtNum } from "@/lib/format";
import { Stat, ToolsUnavailable } from "./shared";

export function ExposureDashboard() {
  const t = useTranslations("tools");
  const [balance, setBalance] = React.useState("10000");
  const [currency, setCurrency] = React.useState("USD");
  const [accountId, setAccountId] = React.useState("");
  const settingsQuery = useExposureSettings();
  const settings = settingsQuery.data ?? DEFAULT_EXPOSURE_SETTINGS;
  const saveSettings = useSaveExposureSettings();
  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];
  const updateTrade = useUpdateTrade();
  // Draft threshold inputs: saved to the server on blur, not per keystroke.
  const [dupDraft, setDupDraft] = React.useState(settings.duplicationThresholdPercent);
  const [maxDraft, setMaxDraft] = React.useState(settings.maxCurrencyExposurePercent);
  React.useEffect(() => {
    setDupDraft(settings.duplicationThresholdPercent);
    setMaxDraft(settings.maxCurrencyExposurePercent);
  }, [settings.duplicationThresholdPercent, settings.maxCurrencyExposurePercent]);
  // Current-price edits, committed to Trade.currentPrice on blur.
  const [priceDrafts, setPriceDrafts] = React.useState<Record<string, string>>({});

  const toolsUnavailable =
    isToolsTablesMissing(settingsQuery.error) ||
    isToolsTablesMissing(fxRatesQuery.error);

  const commitSettings = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    if (
      next.duplicationThresholdPercent === settings.duplicationThresholdPercent &&
      next.maxCurrencyExposurePercent === settings.maxCurrencyExposurePercent &&
      next.enabled === settings.enabled
    ) {
      return;
    }
    saveSettings.mutate({
      enabled: next.enabled,
      duplicationThresholdPercent: next.duplicationThresholdPercent,
      maxCurrencyExposurePercent: next.maxCurrencyExposurePercent,
    });
  };

  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const account = accounts?.find((item) => item.id === accountId) ?? accounts?.[0];
  const { data: instruments } = useInstruments();
  const openTrades = useTradesList({
    page: 1,
    pageSize: 100,
    sort: "entryTime",
    order: "desc",
    includeDrafts: false,
    status: "OPEN",
    accountId: account?.id,
  });
  React.useEffect(() => {
    if (!account) return;
    setBalance(account.initialBalance);
    setCurrency(account.currency);
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fxInputs = React.useMemo(
    () => fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate })),
    [fxRates]
  );

  const contractSizeBySymbol = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of PRESET_INSTRUMENTS) map.set(p.symbol, p.contractSize);
    for (const i of instruments ?? []) map.set(i.symbol, i.contractSize);
    return map;
  }, [instruments]);

  const trades: OpenTradeLike[] = React.useMemo(() => {
    return (openTrades.data?.data ?? [])
      .filter((item) => account !== undefined && item.accountId === account.id)
      .map((item) => ({
      id: item.id,
      symbol: item.symbol,
      direction: item.direction,
      lots: item.lots,
      entryPrice: item.entryPrice,
      stopLoss: item.stopLoss,
      currentPrice:
        priceDrafts[item.id] !== undefined
          ? priceDrafts[item.id] === ""
            ? null
            : priceDrafts[item.id]
          : item.currentPrice,
      strategyName: item.strategyName,
      accountCurrency: currency,
      riskAmount: null,
    }));
  }, [openTrades.data, priceDrafts, currency, account?.id]);

  const summary = React.useMemo(() => {
    const decomposed = trades.map((trade) =>
      decomposeTrade(
        trade,
        currency,
        contractSizeBySymbol.get(trade.symbol) ?? findPreset(trade.symbol)?.contractSize ?? "100000",
        fxInputs
      )
    );
    return { decomposed, summary: aggregateExposure(decomposed) };
  }, [trades, currency, contractSizeBySymbol, fxInputs]);

  const duplications = React.useMemo(
    () => detectDuplication(summary.summary, balance, settings),
    [summary, balance, settings]
  );

  const loading = accountsLoading || (!!account && openTrades.isLoading);
  const noStopLossCount = summary.summary.noStopLoss.length;

  return (
    <div className="space-y-6">
      {toolsUnavailable && <ToolsUnavailable />}
      {summary.summary.missingFxSymbols.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("exposureMissingFx", { symbols: summary.summary.missingFxSymbols.join(", ") })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="ex-account">{t("exposureAccount")}</Label>
          <Select value={account?.id ?? ""} onValueChange={setAccountId}>
            <SelectTrigger id="ex-account" className="w-full">
              <SelectValue placeholder={t("exposureAccountPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(accounts ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} ({item.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ex-balance">{t("balance")}</Label>
          <Input id="ex-balance" type="number" inputMode="decimal" min="0" step="any"
            value={balance} onChange={(e) => setBalance(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ex-dup">{t("exposureDupThreshold")}</Label>
          <Input id="ex-dup" type="number" inputMode="decimal" min="0" step="0.5"
            value={dupDraft}
            onChange={(e) => setDupDraft(e.target.value)}
            onBlur={() => commitSettings({ duplicationThresholdPercent: dupDraft })}
            className="tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ex-max">{t("exposureMaxCurrency")}</Label>
          <Input id="ex-max" type="number" inputMode="decimal" min="0" step="0.5"
            value={maxDraft}
            onChange={(e) => setMaxDraft(e.target.value)}
            onBlur={() => commitSettings({ maxCurrencyExposurePercent: maxDraft })}
            className="tabular-nums" />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("exposureLoading")}</p>
      ) : trades.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("exposureEmpty")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("exposureOpenTrades")} value={String(trades.length)} />
            <Stat label={t("exposureTotalRisk")} value={`${fmtNum(summary.summary.totalOpenRisk, 2)} ${currency}`} />
            <Stat label={t("exposureNoStopLoss")} value={String(noStopLossCount)} />
            <Stat label={t("exposureAlerts")} value={String(duplications.length)} />
          </dl>

          {duplications.length > 0 && (
            <div className="space-y-2">
              {duplications.map((d) => (
                <p key={`${d.currency}-${d.direction}`}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {t("exposureDuplication", {
                    currency: d.currency,
                    direction: d.direction === "LONG" ? t("long") : t("short"),
                    count: d.positionCount,
                    pct: fmtNum(d.riskPctOfBalance, 1),
                  })}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("exposureByCurrency")}</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("exposureColCurrency")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColNotional")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColPositions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.summary.byCurrency.map((c) => (
                    <tr key={c.currency} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{c.currency}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.notional.gte(0) ? "+" : ""}{fmtNum(c.notional, 0)} {currency}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.risk.gte(0) ? "+" : ""}{fmtNum(c.risk, 2)} {currency}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.positionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("exposureByInstrument")}</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("instrument")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("exposureColRisk")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("exposureColPositions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.summary.byInstrument.map((row) => (
                      <tr key={row.key} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium tabular-nums">{row.key}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.risk, 2)} {currency}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("exposureByStrategy")}</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("exposureColStrategy")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("exposureColRisk")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("exposureColPositions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.summary.byStrategy.map((row) => (
                      <tr key={row.key} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{row.key === "" ? t("exposureNoStrategy") : row.key}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.risk, 2)} {currency}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Open trades: current price + no-SL flag ── */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("exposureOpenTitle")}</h3>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("exposurePriceHint")}
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("instrument")}</th>
                    <th className="px-3 py-2 font-medium">{t("direction")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("entry")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColCurrentPrice")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("exposureColFloating")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.decomposed.map((d) => (
                    <tr key={d.trade.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {d.trade.symbol}
                        {!d.hasStopLoss && (
                          <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                            {t("exposureNoSl")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{d.trade.direction}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(d.trade.entryPrice, 4)}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          aria-label={t("exposureCurrentPriceAria", { symbol: d.trade.symbol })}
                          type="number" inputMode="decimal" step="any"
                          className="ml-auto w-28 text-right tabular-nums"
                          value={priceDrafts[d.trade.id] ?? d.trade.currentPrice ?? ""}
                          placeholder={fmtNum(d.trade.entryPrice, 4)}
                          onChange={(e) =>
                            setPriceDrafts((prev) => ({ ...prev, [d.trade.id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const stored =
                              (openTrades.data?.data ?? []).find((x) => x.id === d.trade.id)
                                ?.currentPrice ?? "";
                            if (raw !== stored) {
                              updateTrade.mutate({
                                id: d.trade.id,
                                patch: { currentPrice: raw === "" ? null : raw },
                              });
                            }
                            setPriceDrafts((prev) => {
                              const next = { ...prev };
                              delete next[d.trade.id];
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(d.openRisk, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.floatingPnl !== null ? `${d.floatingPnl.gte(0) ? "+" : ""}${fmtNum(d.floatingPnl, 2)}` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <button type="button" className="text-xs text-muted-foreground underline"
        onClick={() => saveSettings.mutate({
          enabled: DEFAULT_EXPOSURE_SETTINGS.enabled,
          duplicationThresholdPercent: DEFAULT_EXPOSURE_SETTINGS.duplicationThresholdPercent,
          maxCurrencyExposurePercent: DEFAULT_EXPOSURE_SETTINGS.maxCurrencyExposurePercent,
        })}>
        {t("exposureResetSettings")}
      </button>
    </div>
  );
}
