"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Info, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/privacy/money";
import { previewTrade } from "@/lib/trading/calculate";
import { resolveConversionRate } from "@/lib/tools/fx";
import {
  isToolsTablesMissing,
  useCreateToolScenario,
  useDeleteToolScenario,
  useFxRates,
  useToolScenarios,
} from "@/hooks/use-tools";
import type { ToolScenario } from "@/lib/tools/types";
import { parsePnlSimulatorScenario } from "@/lib/tools/scenario-payloads";
import { ToolsUnavailable } from "./shared";
import { findPreset, PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { toD } from "@/lib/trading/dec";
import { COMMON_CURRENCIES, type AssetClass, type Direction } from "@/lib/trading/types";
import { fmtNum, fmtPrice, pnlClass } from "@/lib/format";

const GROUP_ORDER: AssetClass[] = ["METAL", "FOREX", "INDEX", "CRYPTO", "COMMODITY"];

interface Level {
  key: string;
  label: string;
  price: number | null;
  color: string;
}

export function PnlSimulator() {
  const t = useTranslations("tools");
  const tRoot = useTranslations();

  const [symbol, setSymbol] = React.useState("XAUUSD");
  const [direction, setDirection] = React.useState<Direction>("LONG");
  const [lots, setLots] = React.useState("0.50");
  const [entry, setEntry] = React.useState("2345.00");
  const [exit, setExit] = React.useState("2351.80");
  const [stopLoss, setStopLoss] = React.useState("2340.00");
  const [takeProfit, setTakeProfit] = React.useState("2358.00");
  const [commission, setCommission] = React.useState("7");
  const [swap, setSwap] = React.useState("0");
  const [accountCurrency, setAccountCurrency] = React.useState("USD");
  const [manualRate, setManualRate] = React.useState("");
  const [scenarioName, setScenarioName] = React.useState("");
  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];
  const scenariosQuery = useToolScenarios("PNL_SIMULATOR");
  const scenarios = scenariosQuery.data ?? [];
  const createScenario = useCreateToolScenario();
  const deleteScenario = useDeleteToolScenario();
  const toolsUnavailable = isToolsTablesMissing(scenariosQuery.error);

  const instrument = React.useMemo(
    () => findPreset(symbol) ?? PRESET_INSTRUMENTS[0],
    [symbol]
  );

  const needsRate = instrument.quoteCurrency !== accountCurrency;
  const manualRateValue = manualRate.trim() === "" ? null : toD(manualRate);
  const manualRateInvalid =
    needsRate &&
    manualRateValue !== null &&
    (!manualRateValue.isFinite() || manualRateValue.lte(0));
  // This lookup is inexpensive; keeping it outside useMemo avoids stale
  // FX values and React Compiler's conflicting dependency inference.
  const resolvedRate = !needsRate
    ? null
    : manualRateValue !== null
      ? manualRateInvalid
        ? null
        : manualRateValue.toString()
      : resolveConversionRate(
          instrument.quoteCurrency ?? "",
          accountCurrency,
          fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate, date: r.date, source: r.source }))
        )?.toString() ?? null;
  const conversionReady = !needsRate || resolvedRate !== null;

  const preview = React.useMemo(
    () =>
      previewTrade({
        instrument,
        direction,
        lots,
        entry,
        exit,
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null,
        commission,
        swap,
        accountCurrency,
        quoteToAccountRate: needsRate ? resolvedRate : null,
        fxRates: fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate, date: r.date, source: r.source })),
      }),
    [instrument, direction, lots, entry, exit, stopLoss, takeProfit, commission, swap, accountCurrency, needsRate, resolvedRate, fxRates]
  );

  const saveScenario = () => {
    const name = scenarioName.trim();
    if (!name) return;
    createScenario.mutate({
      name,
      kind: "PNL_SIMULATOR",
      payload: {
        symbol,
        direction,
        lots,
        entry,
        exit,
        stopLoss,
        takeProfit,
        commission,
        swap,
        accountCurrency,
        manualRate,
      },
    });
    setScenarioName("");
  };

  const loadScenario = (s: ToolScenario) => {
    const p = parsePnlSimulatorScenario(s.payload);
    if (p.symbol) setSymbol(p.symbol);
    if (p.direction) setDirection(p.direction);
    if (p.lots) setLots(p.lots);
    if (p.entry) setEntry(p.entry);
    if (p.exit) setExit(p.exit);
    if (p.stopLoss !== undefined) setStopLoss(p.stopLoss);
    if (p.takeProfit !== undefined) setTakeProfit(p.takeProfit);
    if (p.commission) setCommission(p.commission);
    if (p.swap) setSwap(p.swap);
    if (p.accountCurrency) setAccountCurrency(p.accountCurrency);
    if (p.manualRate !== undefined) setManualRate(p.manualRate);
  };

  const levels: Level[] = [
    { key: "sl", label: "SL", price: stopLoss ? toD(stopLoss).toNumber() : null, color: "bg-red-500" },
    { key: "entry", label: t("entryShort"), price: entry ? toD(entry).toNumber() : null, color: "bg-foreground" },
    { key: "exit", label: t("exitShort"), price: exit ? toD(exit).toNumber() : null, color: "bg-amber-500" },
    { key: "tp", label: "TP", price: takeProfit ? toD(takeProfit).toNumber() : null, color: "bg-emerald-500" },
  ];
  const validLevels = levels.filter((l): l is Level & { price: number } => l.price !== null);
  const min = validLevels.length ? Math.min(...validLevels.map((l) => l.price)) : 0;
  const max = validLevels.length ? Math.max(...validLevels.map((l) => l.price)) : 0;
  const span = max - min || 1;
  const pos = (p: number) => ((p - min) / span) * 80 + 10; // 10-90 % padding

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {isToolsTablesMissing(fxRatesQuery.error) && <ToolsUnavailable />}
      {/* ── Form ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="sim-instrument">{t("instrument")}</Label>
          <Select value={symbol} onValueChange={(value) => { setSymbol(value); setManualRate(""); }}>
            <SelectTrigger id="sim-instrument" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {GROUP_ORDER.map((group) => {
                const items = PRESET_INSTRUMENTS.filter((i) => i.assetClass === group);
                if (!items.length) return null;
                return (
                  <SelectGroup key={group}>
                    <SelectLabel>{tRoot(`trading.assetClass.${group}`)}</SelectLabel>
                    {items.map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>
                        <span className="font-medium tabular-nums">{i.symbol}</span>
                        <span className="ml-2 text-muted-foreground">{i.name}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-account-currency">{t("accountCurrency")}</Label>
          <Select
            value={accountCurrency}
            onValueChange={(value) => {
              setAccountCurrency(value);
              setManualRate("");
            }}
          >
            <SelectTrigger id="sim-account-currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_CURRENCIES.map((currency) => (
                <SelectItem key={currency} value={currency}>{currency}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {needsRate && (
          <div className="space-y-2">
            <Label htmlFor="sim-fx-rate">{t("manualFxRate")}</Label>
            <Input
              id="sim-fx-rate"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={manualRate}
              onChange={(e) => setManualRate(e.target.value)}
              placeholder={resolvedRate ?? t("fxRateFromSaved")}
              className="tabular-nums"
            />
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Label>{t("direction")}</Label>
          <ToggleGroup
            type="single"
            value={direction}
            onValueChange={(v) => v && setDirection(v as Direction)}
            className="w-full"
          >
            <ToggleGroupItem value="LONG" className="flex-1" aria-label={t("longAria")}>
              {t("long")}
            </ToggleGroupItem>
            <ToggleGroupItem value="SHORT" className="flex-1" aria-label={t("shortAria")}>
              {t("short")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-lots">{t("lots")}</Label>
          <Input
            id="sim-lots"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={lots}
            onChange={(e) => setLots(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-entry">{t("entryShort")}</Label>
          <Input
            id="sim-entry"
            type="number"
            inputMode="decimal"
            step="any"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-exit">{t("exitShort")}</Label>
          <Input
            id="sim-exit"
            type="number"
            inputMode="decimal"
            step="any"
            value={exit}
            onChange={(e) => setExit(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-sl">{t("stopLoss")}</Label>
          <Input
            id="sim-sl"
            type="number"
            inputMode="decimal"
            step="any"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-tp">{t("takeProfit")}</Label>
          <Input
            id="sim-tp"
            type="number"
            inputMode="decimal"
            step="any"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-commission">{t("commission")}</Label>
          <Input
            id="sim-commission"
            type="number"
            inputMode="decimal"
            step="any"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sim-swap">{t("swap")}</Label>
          <Input
            id="sim-swap"
            type="number"
            inputMode="decimal"
            step="any"
            value={swap}
            onChange={(e) => setSwap(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>

      {/* ── Results ── */}
      <div className="space-y-4">
        <div className="rounded-xl border bg-muted/40 p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("netPnlEstimate")}
            </p>
            {conversionReady && (
              <Badge
                variant={preview.resultType === "WIN" ? "default" : preview.resultType === "LOSS" ? "destructive" : "secondary"}
                className={
                  preview.resultType === "WIN"
                    ? "bg-emerald-600 hover:bg-emerald-600"
                    : undefined
                }
              >
                {tRoot(`trading.result.${preview.resultType}`)}
              </Badge>
            )}
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
            {conversionReady ? (
              <Money
                signed
                value={preview.netPnl}
                currency={accountCurrency}
                className={pnlClass(preview.netPnl)}
              />
            ) : (
              <span className="text-base font-medium text-muted-foreground">
                {"—"}
              </span>
            )}
          </p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${pnlClass(preview.pips)}`}>
            {preview.pips.gt(0) ? "+" : preview.pips.lt(0) ? "−" : ""}
            {fmtNum(preview.pips.abs(), 1)} {t("pips")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {fmtNum(preview.points.abs(), 1)} {t("points")}
            </span>
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat
            label={t("grossPnl")}
            value={conversionReady ? <Money signed value={preview.grossPnl} currency={accountCurrency} /> : "-"}
          />
          <MiniStat
            label={t("totalCosts")}
            value={conversionReady ? <Money value={preview.totalCosts} currency={accountCurrency} /> : "-"}
          />
          <MiniStat
            label={t("rMultipleNet")}
            value={preview.rMultiple ? `${fmtNum(preview.rMultiple, 2)} R` : "-"}
            valueClass={pnlClass(preview.rMultiple)}
          />
          <MiniStat
            label={t("rMultipleGross")}
            value={preview.grossRMultiple ? `${fmtNum(preview.grossRMultiple, 2)} R` : "-"}
            valueClass={pnlClass(preview.grossRMultiple)}
          />
          <MiniStat
            label={t("plannedRR")}
            value={preview.plannedRR ? `1 : ${fmtNum(preview.plannedRR, 2)}` : "-"}
          />
          <MiniStat
            label={t("pnlPerPip")}
            value={
              preview.pips.isZero() ? (
                "-"
              ) : (
                conversionReady ? (
                  <Money
                    value={preview.grossPnl.div(preview.pips)}
                    currency={accountCurrency}
                  />
                ) : (
                  "-"
                )
              )
            }
          />
        </dl>

        {/* Levels visualization */}
        <div className="rounded-xl border p-4" aria-hidden="true">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("levels")}
          </p>
          <div className="relative h-1.5 rounded-full bg-muted">
            {validLevels.map((l) => (
              <div
                key={l.key}
                className="absolute -top-[5px] h-4 w-1 rounded-full"
                style={{ left: `${pos(l.price)}%`, transform: "translateX(-50%)" }}
              >
                <div className={`h-full w-full rounded-full ${l.color}`} />
              </div>
            ))}
          </div>
          <div className="relative mt-3 h-10">
            {validLevels.map((l) => (
              <div
                key={l.key}
                className="absolute flex flex-col items-center"
                style={{ left: `${pos(l.price)}%`, transform: "translateX(-50%)" }}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {l.label}
                </span>
                <span className="text-xs tabular-nums">
                  {fmtPrice(l.price, instrument.digits)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {manualRateInvalid ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {t("invalidConversionRate")}
          </p>
        ) : needsRate && !conversionReady ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            {t("pnlMissingFx")}
          </p>
        ) : preview.isEstimate && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("quoteDiffersNote", { quote: instrument.quoteCurrency, currency: accountCurrency })}
          </p>
        )}
      </div>
      </div>

      {/* ── Scenarios ── */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="sim-scenario-name">{t("scenarioName")}</Label>
            <Input
              id="sim-scenario-name"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder={t("scenarioNamePlaceholder")}
            />
          </div>
          <Button
            variant="outline"
            onClick={saveScenario}
            disabled={scenarioName.trim() === ""}
          >
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("scenarioSave")}
          </Button>
        </div>
        {toolsUnavailable && <ToolsUnavailable />}
        {scenarios.length > 0 && (
          <ul className="space-y-1">
            {scenarios.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                  onClick={() => loadScenario(s)}
                >
                  {s.name}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("scenarioDelete", { name: s.name })}
                  onClick={() => deleteScenario.mutate(s.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${valueClass ?? ""}`}>
        {value}
      </dd>
    </div>
  );
}
