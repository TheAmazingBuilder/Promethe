"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Calculator, Info, Save, Trash2 } from "lucide-react";
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
import { toD } from "@/lib/trading/dec";
import {
  isToolsTablesMissing,
  useCreateToolScenario,
  useDeleteToolScenario,
  useFxRates,
  useToolScenarios,
} from "@/hooks/use-tools";
import type { ToolScenario } from "@/lib/tools/types";
import {
  parsePositionSizeScenario,
  type RiskBasis,
  type RiskMode,
} from "@/lib/tools/scenario-payloads";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { COMMON_CURRENCIES, type AssetClass, type Direction } from "@/lib/trading/types";
import { fmtNum, fmtPrice } from "@/lib/format";
import { sizingErrorMessage } from "@/lib/i18n-errors";
import { ToolsUnavailable } from "./shared";

const GROUP_ORDER: AssetClass[] = ["METAL", "FOREX", "INDEX", "CRYPTO", "COMMODITY"];

export function PositionSizeCalculator() {
  const t = useTranslations("tools");
  const tRoot = useTranslations();

  const [symbol, setSymbol] = React.useState("XAUUSD");
  const [balance, setBalance] = React.useState("10000");
  const [currency, setCurrency] = React.useState("USD");
  // Risk basis (MD §3.5, 6a): BALANCE is the default. EQUITY needs a
  // manually entered current equity — live equity is not available to
  // this tool, so the equity option never silently falls back to balance.
  const [riskBasis, setRiskBasis] = React.useState<RiskBasis>("BALANCE");
  const [accountEquity, setAccountEquity] = React.useState("");
  const [riskMode, setRiskMode] = React.useState<RiskMode>("percent");
  const [riskPercent, setRiskPercent] = React.useState("1");
  const [riskAmount, setRiskAmount] = React.useState("100");
  const [estimatedCosts, setEstimatedCosts] = React.useState("");
  const [direction, setDirection] = React.useState<Direction>("LONG");
  const [entry, setEntry] = React.useState("2345.00");
  const [stopLoss, setStopLoss] = React.useState("2340.00");
  const [rate, setRate] = React.useState("");
  const [lotStep, setLotStep] = React.useState("0.01");
  const [minLots, setMinLots] = React.useState("0.01");
  const [maxLots, setMaxLots] = React.useState("");
  const [scenarioName, setScenarioName] = React.useState("");

  const instrument = React.useMemo(
    () => PRESET_INSTRUMENTS.find((i) => i.symbol === symbol) ?? PRESET_INSTRUMENTS[0],
    [symbol]
  );

  const needsRate = instrument.quoteCurrency !== currency;
  const lotPrecision = Math.min(6, Math.max(2, toD(lotStep).decimalPlaces()));

  // Stored FxRate table: fallback when no manual rate is typed (its
  // rateDate/source surface on the result as provenance). Best-effort —
  // a failed fetch just leaves the list empty.
  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];
  const scenariosQuery = useToolScenarios("POSITION_SIZE");
  const scenarios = scenariosQuery.data ?? [];
  const createScenario = useCreateToolScenario();
  const deleteScenario = useDeleteToolScenario();
  const toolsUnavailable = isToolsTablesMissing(scenariosQuery.error);

  const result = React.useMemo(() => {
    return calcPositionSize({
      accountBalance: balance,
      riskBasis,
      accountEquity: riskBasis === "EQUITY" ? accountEquity : null,
      riskPercent: riskMode === "percent" ? riskPercent : null,
      riskAmount: riskMode === "amount" ? riskAmount : null,
      estimatedCosts: estimatedCosts.trim() === "" ? null : estimatedCosts,
      entry,
      stopLoss,
      instrument,
      direction,
      accountCurrency: currency,
      quoteToAccountRate: needsRate && rate !== "" ? rate : null,
      // The rate field is labeled quote→account: pass that orientation
      // so an inverted typed pair is corrected, not used backwards.
      quoteToAccountRatePair: needsRate
        ? { base: instrument.quoteCurrency, quote: currency }
        : null,
      fxRates: fxRates.map((r) => ({
        base: r.base,
        quote: r.quote,
        rate: r.rate,
        date: r.date,
        source: r.source,
      })),
      lotStep,
      minLots,
      maxLots: maxLots.trim() === "" ? null : maxLots,
    });
  }, [
    balance,
    riskBasis,
    accountEquity,
    riskMode,
    riskPercent,
    riskAmount,
    estimatedCosts,
    entry,
    stopLoss,
    instrument,
    direction,
    currency,
    needsRate,
    rate,
    fxRates,
    lotStep,
    minLots,
    maxLots,
  ]);

  const saveScenario = () => {
    const name = scenarioName.trim();
    if (!name) return;
    createScenario.mutate({
      name,
      kind: "POSITION_SIZE",
      payload: {
        symbol,
        balance,
        currency,
        riskBasis,
        accountEquity,
        riskMode,
        riskPercent,
        riskAmount,
        direction,
        entry,
        stopLoss,
        rate,
        lotStep,
        minLots,
        maxLots,
        estimatedCosts,
      },
    });
    setScenarioName("");
  };

  const loadScenario = (s: ToolScenario) => {
    const p = parsePositionSizeScenario(s.payload);
    if (p.symbol) setSymbol(p.symbol);
    if (p.balance) setBalance(p.balance);
    if (p.currency) setCurrency(p.currency);
    if (p.riskBasis) setRiskBasis(p.riskBasis);
    if (p.accountEquity !== undefined) setAccountEquity(p.accountEquity);
    if (p.riskMode) setRiskMode(p.riskMode);
    if (p.riskPercent) setRiskPercent(p.riskPercent);
    if (p.riskAmount) setRiskAmount(p.riskAmount);
    if (p.direction) setDirection(p.direction);
    if (p.entry) setEntry(p.entry);
    if (p.stopLoss) setStopLoss(p.stopLoss);
    if (p.rate !== undefined) setRate(p.rate);
    if (p.lotStep) setLotStep(p.lotStep);
    if (p.minLots) setMinLots(p.minLots);
    if (p.maxLots !== undefined) setMaxLots(p.maxLots);
    if (p.estimatedCosts !== undefined) setEstimatedCosts(p.estimatedCosts);
  };

  return (
    <div className="space-y-6">
      {toolsUnavailable && <ToolsUnavailable />}
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

          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">{t("brokerVolumeRules")}</p>
            <p className="text-xs text-muted-foreground">{t("brokerVolumeRulesHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ps-lot-step">{t("lotStep")}</Label>
                <Input
                  id="ps-lot-step"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={lotStep}
                  onChange={(e) => setLotStep(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-min-lots">{t("minLots")}</Label>
                <Input
                  id="ps-min-lots"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={minLots}
                  onChange={(e) => setMinLots(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-max-lots">{t("maxLots")}</Label>
                <Input
                  id="ps-max-lots"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder={t("maxLotsOptional")}
                  value={maxLots}
                  onChange={(e) => setMaxLots(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
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
            <Label>{t("riskBasis")}</Label>
            <ToggleGroup
              type="single"
              value={riskBasis}
              onValueChange={(v) => v && setRiskBasis(v as RiskBasis)}
              className="w-full"
            >
              <ToggleGroupItem value="BALANCE" className="flex-1">
                {t("riskBasisBalance")}
              </ToggleGroupItem>
              <ToggleGroupItem value="EQUITY" className="flex-1">
                {t("riskBasisEquity")}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {riskBasis === "EQUITY" ? t("riskBasisEquityHint") : t("riskBasisBalanceHint")}
            </p>
          </div>

          {riskBasis === "EQUITY" && (
            <div className="space-y-2">
              <Label htmlFor="ps-equity">{t("accountEquity")}</Label>
              <Input
                id="ps-equity"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={accountEquity}
                onChange={(e) => setAccountEquity(e.target.value)}
                className="tabular-nums"
              />
            </div>
          )}

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
            <Label htmlFor="ps-costs">{t("estimatedCosts")}</Label>
            <Input
              id="ps-costs"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0"
              value={estimatedCosts}
              onChange={(e) => setEstimatedCosts(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-xs text-muted-foreground">{t("estimatedCostsHint")}</p>
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
            setRiskBasis("BALANCE");
            setAccountEquity("");
            setRiskMode("percent");
            setRiskPercent("1");
            setEstimatedCosts("");
            setDirection("LONG");
            setRate("");
            setLotStep("0.01");
            setMinLots("0.01");
            setMaxLots("");
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
                {fmtNum(result.lots, lotPrecision, lotPrecision)}
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
          <Stat
            label={t("tickValue")}
            value={
              result.valid && result.tickValue
                ? `${fmtNum(result.tickValue.account, 2)} ${currency}`
                : "—"
            }
            hint={
              result.tickDataMissing
                ? t("tickValueMissing")
                : needsRate && result.tickValue
                  ? `${fmtNum(result.tickValue.quote, 2)} ${instrument.quoteCurrency}`
                  : undefined
            }
          />
        </dl>

        {result.valid && result.capped && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("sizeCapped", {
              maxLots: maxLots.trim(),
              risk: fmtNum(result.actualRiskAmount, 2),
              currency,
            })}
          </p>
        )}
        {result.valid && result.costsDeducted.gt(0) && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("costsDeductedNote", {
              amount: fmtNum(result.costsDeducted, 2),
              currency,
            })}
          </p>
        )}
        {result.valid && result.costsDeducted.isZero() && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("costsBeforeNote")}
          </p>
        )}

        {result.isEstimate && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("convertedEstimate")}
          </p>
        )}
        {result.valid && result.rateSource === "MANUAL" && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("rateManualUndated")}
          </p>
        )}
        {result.valid && result.rateSource === "STORED" && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {result.rateDate
              ? t("rateStored", { date: result.rateDate })
              : t("rateStoredUndated")}
          </p>
        )}
        {result.valid && result.rateStale && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {result.rateDate
              ? t("rateStale", { date: result.rateDate })
              : t("rateStaleUndated")}
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("roundingNote")}
        </p>
      </div>
      </div>

      {/* ── Scenarios ── */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="ps-scenario-name">{t("scenarioName")}</Label>
            <Input
              id="ps-scenario-name"
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
