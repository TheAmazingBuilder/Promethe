"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Calculator, Info } from "lucide-react";
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
import { calcPositionSize } from "@/lib/trading/calculate";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { COMMON_CURRENCIES, type AssetClass, type Direction } from "@/lib/trading/types";
import { fmtNum, fmtPrice } from "@/lib/format";
import { sizingErrorMessage } from "@/lib/i18n-errors";

const GROUP_ORDER: AssetClass[] = ["METAL", "FOREX", "INDEX", "CRYPTO", "COMMODITY"];

export function PositionSizeCalculator() {
  const t = useTranslations("tools");
  const tRoot = useTranslations();

  const [symbol, setSymbol] = React.useState("XAUUSD");
  const [balance, setBalance] = React.useState("10000");
  const [currency, setCurrency] = React.useState("USD");
  const [riskMode, setRiskMode] = React.useState<"percent" | "amount">("percent");
  const [riskPercent, setRiskPercent] = React.useState("1");
  const [riskAmount, setRiskAmount] = React.useState("100");
  const [direction, setDirection] = React.useState<Direction>("LONG");
  const [entry, setEntry] = React.useState("2345.00");
  const [stopLoss, setStopLoss] = React.useState("2340.00");
  const [rate, setRate] = React.useState("");

  const instrument = React.useMemo(
    () => PRESET_INSTRUMENTS.find((i) => i.symbol === symbol) ?? PRESET_INSTRUMENTS[0],
    [symbol]
  );

  const needsRate = instrument.quoteCurrency !== currency;

  const result = React.useMemo(() => {
    return calcPositionSize({
      accountBalance: balance,
      riskPercent: riskMode === "percent" ? riskPercent : null,
      riskAmount: riskMode === "amount" ? riskAmount : null,
      entry,
      stopLoss,
      instrument,
      direction,
      accountCurrency: currency,
      quoteToAccountRate: needsRate && rate !== "" ? rate : null,
    });
  }, [balance, riskMode, riskPercent, riskAmount, entry, stopLoss, instrument, direction, currency, needsRate, rate]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Form ── */}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ps-instrument">{t("instrument")}</Label>
            <Select
              value={symbol}
              onValueChange={(value) => {
                setSymbol(value);
                setRate("");
              }}
            >
              <SelectTrigger id="ps-instrument" className="w-full">
                <SelectValue placeholder={t("instrumentPlaceholder")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {GROUP_ORDER.map((group) => {
                  const items = PRESET_INSTRUMENTS.filter((i) => i.assetClass === group);
                  if (items.length === 0) return null;
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
            <Label htmlFor="ps-balance">{t("balance")}</Label>
            <Input
              id="ps-balance"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ps-currency">{t("accountCurrency")}</Label>
            <Select
              value={currency}
              onValueChange={(value) => {
                setCurrency(value);
                setRate("");
              }}
            >
              <SelectTrigger id="ps-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>{t("risk")}</Label>
            <div className="flex gap-2">
              <ToggleGroup
                type="single"
                value={riskMode}
                onValueChange={(v) => v && setRiskMode(v as "percent" | "amount")}
                className="shrink-0"
              >
                <ToggleGroupItem value="percent" aria-label={t("riskPercentAria")}>
                  %
                </ToggleGroupItem>
                <ToggleGroupItem value="amount" aria-label={t("riskAmountAria")}>
                  {currency}
                </ToggleGroupItem>
              </ToggleGroup>
              <Input
                aria-label={
                  riskMode === "percent"
                    ? t("riskPercentInputAria")
                    : t("riskAmountInputAria", { currency })
                }
                type="number"
                inputMode="decimal"
                min="0"
                step={riskMode === "percent" ? "0.05" : "any"}
                value={riskMode === "percent" ? riskPercent : riskAmount}
                onChange={(e) =>
                  riskMode === "percent"
                    ? setRiskPercent(e.target.value)
                    : setRiskAmount(e.target.value)
                }
                className="tabular-nums"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {riskMode === "percent"
                ? t("riskAmountHint", { amount: fmtNum(result.riskAmount, 2), currency })
                : t("riskPercentHint", {
                    amount: fmtNum(
                      Number(balance) > 0 ? (Number(riskAmount) / Number(balance)) * 100 : 0,
                      2
                    ),
                  })}
            </p>
          </div>

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
            <Label htmlFor="ps-entry">{t("entry")}</Label>
            <Input
              id="ps-entry"
              type="number"
              inputMode="decimal"
              step="any"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ps-sl">{t("stopLoss")}</Label>
            <Input
              id="ps-sl"
              type="number"
              inputMode="decimal"
              step="any"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="tabular-nums"
            />
          </div>

          {needsRate && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ps-rate">
                {t("rate", { quote: instrument.quoteCurrency, currency })}
              </Label>
              <Input
                id="ps-rate"
                type="number"
                inputMode="decimal"
                step="any"
                placeholder={t("ratePlaceholder", {
                  quote: instrument.quoteCurrency,
                  currency,
                })}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="tabular-nums"
              />
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setBalance("10000");
            setCurrency("USD");
            setRiskMode("percent");
            setRiskPercent("1");
            setDirection("LONG");
            setRate("");
            if (symbol === "XAUUSD") {
              setEntry("2345.00");
              setStopLoss("2340.00");
            }
          }}
        >
          {t("reset")}
        </Button>
      </div>

      {/* ── Results ── */}
      <div className="space-y-3">
        <div className="rounded-xl border bg-muted/40 p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("recommendedSize")}
          </p>
          {result.valid ? (
            <>
              <p className="mt-2 text-5xl font-bold tabular-nums tracking-tight text-emerald-500 dark:text-emerald-400">
                {fmtNum(result.lots, 2, 2)}
                <span className="ml-2 text-xl font-semibold text-muted-foreground">
                  {instrument.assetClass === "FOREX" || instrument.assetClass === "METAL"
                    ? t("lotsUnit")
                    : t("unitsUnit")}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {t("spotUnits", {
                  units: fmtNum(result.units, 2),
                  base: instrument.baseCurrency ?? t("unitsUnit"),
                })}
              </p>
            </>
          ) : (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {sizingErrorMessage(tRoot, result.reason, result.minLots.toString())}
              </p>
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <Stat
            label={t("actualRisk")}
            value={result.valid ? `${fmtNum(result.actualRiskAmount, 2)} ${currency}` : "—"}
          />
          <Stat
            label={t("stopDistance")}
            value={
              result.stopPips
                ? `${fmtNum(result.stopPips, 1)} ${t("pips")}`
                : "-"
            }
            hint={result.stopDist ? fmtPrice(result.stopDist, instrument.digits) : undefined}
          />
          <Stat
            label={t("pipValue")}
            value={result.valid ? `${fmtNum(result.pipValue.account, 2)} ${currency}` : "—"}
            hint={
              needsRate
                ? t("pipValueHint", {
                    value: fmtNum(result.pipValue.quote, 2),
                    quote: instrument.quoteCurrency,
                  })
                : undefined
            }
          />
          <Stat
            label={t("notional")}
            value={result.valid ? `${fmtNum(result.notionalQuote, 0)} ${instrument.quoteCurrency}` : "—"}
          />
        </dl>

        {result.isEstimate && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("convertedEstimate")}
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("roundingNote")}
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground tabular-nums">{hint}</dd>}
    </div>
  );
}
