/**
 * v2.5 Module 5 (a) - multi-TP position sizing.
 *
 * Size is computed once on the total risk (entry vs SL), then split across
 * up to 4 take-profits with an allocation % per tier (sum = 100%).
 * Scenarios save to the server (ToolScenario) and the state can be
 * shared with a link: /tools?tab=multi-tp&mtp=<base64url JSON>.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Link2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { calcMultiTp } from "@/lib/tools/multi-tp";
import { resolveConversionRate } from "@/lib/tools/fx";
import {
  isToolsTablesMissing,
  useCreateToolScenario,
  useDeleteToolScenario,
  useFxRates,
  useToolScenarios,
} from "@/hooks/use-tools";
import type { ToolScenario } from "@/lib/tools/types";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { COMMON_CURRENCIES, type Direction } from "@/lib/trading/types";
import { fmtNum } from "@/lib/format";
import { sizingErrorMessage } from "@/lib/i18n-errors";
import { decodeShareState, encodeShareState, InstrumentSelect, Stat, ToolsUnavailable } from "./shared";

interface TierState {
  price: string;
  allocation: string;
}

interface ShareState {
  symbol?: string;
  balance?: string;
  currency?: string;
  riskPercent?: string;
  riskAmount?: string;
  direction?: Direction;
  entry?: string;
  stopLoss?: string;
  tiers?: TierState[];
}

function readSharedState(): ShareState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return decodeShareState<ShareState>(params.get("mtp"));
}

const DEFAULT_TIERS: TierState[] = [
  { price: "2350.00", allocation: "50" },
  { price: "2360.00", allocation: "30" },
  { price: "2380.00", allocation: "20" },
];

export function MultiTpCalculator() {
  const t = useTranslations("tools");
  const tRoot = useTranslations();
  const [shared] = React.useState<ShareState | null>(() => readSharedState());

  const [symbol, setSymbol] = React.useState(shared?.symbol ?? "XAUUSD");
  const [balance, setBalance] = React.useState(shared?.balance ?? "10000");
  const [currency, setCurrency] = React.useState(shared?.currency ?? "USD");
  const [riskMode, setRiskMode] = React.useState<"percent" | "amount">("percent");
  const [riskPercent, setRiskPercent] = React.useState(shared?.riskPercent ?? "1");
  const [riskAmount, setRiskAmount] = React.useState(shared?.riskAmount ?? "100");
  const [direction, setDirection] = React.useState<Direction>(shared?.direction ?? "LONG");
  const [entry, setEntry] = React.useState(shared?.entry ?? "2345.00");
  const [stopLoss, setStopLoss] = React.useState(shared?.stopLoss ?? "2340.00");
  const [tiers, setTiers] = React.useState<TierState[]>(shared?.tiers ?? DEFAULT_TIERS);
  const [manualRate, setManualRate] = React.useState("");
  const [scenarioName, setScenarioName] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];
  const scenariosQuery = useToolScenarios("MULTI_TP");
  const scenarios = scenariosQuery.data ?? [];
  const createScenario = useCreateToolScenario();
  const deleteScenario = useDeleteToolScenario();
  const toolsUnavailable =
    isToolsTablesMissing(fxRatesQuery.error) ||
    isToolsTablesMissing(scenariosQuery.error);

  const instrument = React.useMemo(
    () => PRESET_INSTRUMENTS.find((i) => i.symbol === symbol) ?? PRESET_INSTRUMENTS[0],
    [symbol]
  );
  const needsRate = instrument.quoteCurrency !== currency;
  const resolvedRate = React.useMemo(() => {
    if (!needsRate) return null;
    if (manualRate !== "") return manualRate;
    return resolveConversionRate(
      instrument.quoteCurrency ?? "",
      currency,
      fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate }))
    )?.toString() ?? null;
  }, [needsRate, manualRate, instrument.quoteCurrency, currency, fxRates]);

  const result = React.useMemo(() => {
    return calcMultiTp({
      accountBalance: balance,
      riskPercent: riskMode === "percent" ? riskPercent : null,
      riskAmount: riskMode === "amount" ? riskAmount : null,
      entry,
      stopLoss,
      instrument,
      direction,
      accountCurrency: currency,
      quoteToAccountRate: needsRate && resolvedRate ? resolvedRate : null,
      tiers: tiers.map((tier) => ({
        price: tier.price === "" ? "0" : tier.price,
        allocationPct: tier.allocation === "" ? "0" : tier.allocation,
      })),
    });
  }, [balance, riskMode, riskPercent, riskAmount, entry, stopLoss, instrument, direction, currency, needsRate, resolvedRate, tiers]);

  const allocationOk = result.allocationValid;
  const targetsOk = result.targetsValid;
  const multiTpScenarios = scenarios.filter((s) => s.kind === "MULTI_TP");

  const shareState: ShareState = {
    symbol, balance, currency, riskPercent, riskAmount, direction, entry, stopLoss, tiers,
  };

  const saveScenario = () => {
    const name = scenarioName.trim();
    if (!name) return;
    createScenario.mutate({
      name,
      kind: "MULTI_TP",
      payload: shareState as unknown as Record<string, unknown>,
    });
    setScenarioName("");
  };

  const loadScenario = (s: ToolScenario) => {
    const p = s.payload as unknown as ShareState;
    if (p.symbol) setSymbol(p.symbol);
    if (p.balance) setBalance(p.balance);
    setManualRate("");
    if (p.currency) setCurrency(p.currency);
    if (p.riskPercent) setRiskPercent(p.riskPercent);
    if (p.riskAmount) setRiskAmount(p.riskAmount);
    if (p.direction) setDirection(p.direction);
    if (p.entry) setEntry(p.entry);
    if (p.stopLoss) setStopLoss(p.stopLoss);
    if (p.tiers) setTiers(p.tiers);
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/tools/multi-tp?mtp=${encodeShareState(shareState as unknown as Record<string, unknown>)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable: keep the button state unchanged.
    }
  };

  const setTier = (index: number, patch: Partial<TierState>) => {
    setTiers((prev) => prev.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };

  return (
    <div className="space-y-6">
      {toolsUnavailable && <ToolsUnavailable />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Form ── */}
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <InstrumentSelect
                id="mtp-instrument"
                value={symbol}
                onChange={(value) => {
                  setSymbol(value);
                  setManualRate("");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mtp-balance">{t("balance")}</Label>
              <Input id="mtp-balance" type="number" inputMode="decimal" min="0" step="any"
                value={balance} onChange={(e) => setBalance(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mtp-currency">{t("accountCurrency")}</Label>
              <Select
                value={currency}
                onValueChange={(value) => {
                  setCurrency(value);
                  setManualRate("");
                }}
              >
                <SelectTrigger id="mtp-currency" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("risk")}</Label>
              <div className="flex gap-2">
                <ToggleGroup type="single" value={riskMode}
                  onValueChange={(v) => v && setRiskMode(v as "percent" | "amount")} className="shrink-0">
                  <ToggleGroupItem value="percent" aria-label={t("riskPercentAria")}>%</ToggleGroupItem>
                  <ToggleGroupItem value="amount" aria-label={t("riskAmountAria")}>{currency}</ToggleGroupItem>
                </ToggleGroup>
                <Input aria-label={riskMode === "percent" ? t("riskPercentInputAria") : t("riskAmountInputAria", { currency })}
                  type="number" inputMode="decimal" min="0" step="any"
                  value={riskMode === "percent" ? riskPercent : riskAmount}
                  onChange={(e) => riskMode === "percent" ? setRiskPercent(e.target.value) : setRiskAmount(e.target.value)}
                  className="tabular-nums" />
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("direction")}</Label>
              <ToggleGroup type="single" value={direction}
                onValueChange={(v) => v && setDirection(v as Direction)} className="w-full">
                <ToggleGroupItem value="LONG" className="flex-1">{t("long")}</ToggleGroupItem>
                <ToggleGroupItem value="SHORT" className="flex-1">{t("short")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mtp-entry">{t("entry")}</Label>
              <Input id="mtp-entry" type="number" inputMode="decimal" step="any"
                value={entry} onChange={(e) => setEntry(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mtp-sl">{t("stopLoss")}</Label>
              <Input id="mtp-sl" type="number" inputMode="decimal" step="any"
                value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="tabular-nums" />
            </div>
            {needsRate && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="mtp-rate">{t("rate", { quote: instrument.quoteCurrency, currency })}</Label>
                <Input id="mtp-rate" type="number" inputMode="decimal" step="any"
                  placeholder={resolvedRate ? t("rateFromTable", { rate: resolvedRate }) : t("ratePlaceholder", { quote: instrument.quoteCurrency, currency })}
                  value={manualRate} onChange={(e) => setManualRate(e.target.value)} className="tabular-nums" />
                {resolvedRate && manualRate === "" && (
                  <p className="text-xs text-muted-foreground">{t("rateFromTableHint", { rate: resolvedRate })}</p>
                )}
              </div>
            )}
          </div>

          {/* ── TP tiers ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("multiTpTiers")}</Label>
              <Button variant="outline" size="sm" disabled={tiers.length >= 4}
                onClick={() => setTiers((prev) => [...prev, { price: "", allocation: "" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("multiTpAddTier")}
              </Button>
            </div>
            {tiers.map((tier, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`mtp-tp-${i}`}>{t("multiTpTierPrice", { n: i + 1 })}</Label>
                  <Input id={`mtp-tp-${i}`} type="number" inputMode="decimal" step="any"
                    value={tier.price} onChange={(e) => setTier(i, { price: e.target.value })} className="tabular-nums" />
                </div>
                <div className="w-24 space-y-1">
                  <Label htmlFor={`mtp-alloc-${i}`}>{t("multiTpAllocation")}</Label>
                  <Input id={`mtp-alloc-${i}`} type="number" inputMode="decimal" min="0" max="100" step="any"
                    value={tier.allocation} onChange={(e) => setTier(i, { allocation: e.target.value })} className="tabular-nums" />
                </div>
                <Button variant="ghost" size="icon" aria-label={t("multiTpRemoveTier", { n: i + 1 })}
                  disabled={tiers.length <= 1} onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <p className={allocationOk ? "text-xs text-muted-foreground" : "text-xs font-medium text-amber-600 dark:text-amber-400"}>
              {t("multiTpAllocationSum", { sum: fmtNum(result.allocationSum, 0) })}
            </p>
            {!allocationOk ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("multiTpAllocationInvalid")}</p>
            ) : null}
            {!targetsOk ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("multiTpTargetInvalid")}</p>
            ) : null}
          </div>
        </div>

        {/* ── Results ── */}
        <div className="space-y-3">
          <div className="rounded-xl border bg-muted/40 p-6 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("recommendedSize")}</p>
            {result.sizing.valid ? (
              <>
                <p className="mt-2 text-5xl font-bold tabular-nums tracking-tight text-emerald-500 dark:text-emerald-400">
                  {fmtNum(result.sizing.lots, 2, 2)}
                  <span className="ml-2 text-xl font-semibold text-muted-foreground">{t("lotsUnit")}</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                  {t("multiTpBlendedR", { r: result.blendedR ? fmtNum(result.blendedR, 2) : "-" })}
                </p>
                {result.sizing.isEstimate ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {t("multiTpRateEstimate")}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {sizingErrorMessage(tRoot, result.sizing.reason, result.sizing.minLots.toString())}
                </p>
              </div>
            )}
          </div>

          {result.sizing.valid && allocationOk && targetsOk && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("multiTpColTier")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("multiTpColPrice")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("multiTpColAlloc")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("multiTpColLots")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("rMultiple")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("multiTpColPnl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tiers.map((tier) => (
                    <tr key={tier.index} className="border-b last:border-0">
                      <td className="px-3 py-2">TP{tier.index + 1}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(tier.price, instrument.digits ?? 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(tier.allocationPct, 0)} %</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(tier.lots, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{tier.rMultiple ? `${fmtNum(tier.rMultiple, 2)}R` : "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(tier.grossPnl, 2)} {currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3">
            <Stat label={t("multiTpTotalPnl")} value={allocationOk && targetsOk && result.sizing.valid ? `${fmtNum(result.totalGrossPnl, 2)} ${currency}` : "—"} />
            <Stat label={t("multiTpWorstCase")} value={`${fmtNum(result.worstCasePnl, 2)} ${currency}`} />
          </dl>
        </div>
      </div>

      {/* ── Scenarios + share ── */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="mtp-scenario-name">{t("scenarioName")}</Label>
            <Input id="mtp-scenario-name" value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder={t("scenarioNamePlaceholder")} />
          </div>
          <Button variant="outline" onClick={saveScenario} disabled={scenarioName.trim() === ""}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("scenarioSave")}
          </Button>
          <Button variant="outline" onClick={() => void copyShareLink()}>
            <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {copied ? t("shareCopied") : t("shareLink")}
          </Button>
        </div>
        {multiTpScenarios.length > 0 && (
          <ul className="space-y-1">
            {multiTpScenarios.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                  onClick={() => loadScenario(s)}>
                  {s.name}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
                <Button variant="ghost" size="icon" aria-label={t("scenarioDelete", { name: s.name })}
                  onClick={() => deleteScenario.mutate(s.id)}>
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
