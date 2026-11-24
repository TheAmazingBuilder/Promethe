/**
 * v2.5 Module 5 (e) - currency converter.
 *
 * Manual rates + CSV import (FxRate table), triangulation through USD and
 * the other majors, with the path shown (e.g. EUR->USD->XAU). The same
 * table feeds calcPnL as the default conversion when no manual rate is
 * given in the calculators.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRightLeft, Plus, Trash2, Upload } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { resolveFxRate } from "@/lib/tools/fx";
import { toD } from "@/lib/trading/dec";
import {
  isToolsTablesMissing,
  useDeleteFxRate,
  useFxRates,
  useImportFxRates,
  useUpsertFxRate,
} from "@/hooks/use-tools";
import { ToolsUnavailable } from "./shared";
import { COMMON_CURRENCIES } from "@/lib/trading/types";
import { fmtNum } from "@/lib/format";

const CONVERTIBLE = [...COMMON_CURRENCIES, "XAU", "XAG", "BTC", "ETH"] as const;

export function CurrencyConverter() {
  const t = useTranslations("tools");
  const [amount, setAmount] = React.useState("100");
  const [from, setFrom] = React.useState("EUR");
  const [to, setTo] = React.useState("USD");
  const fxRatesQuery = useFxRates();
  const rates = fxRatesQuery.data ?? [];
  const upsertRate = useUpsertFxRate();
  const deleteRate = useDeleteFxRate();
  const importRates = useImportFxRates();
  const [base, setBase] = React.useState("EUR");
  const [quote, setQuote] = React.useState("USD");
  const [rate, setRate] = React.useState("");
  const [csv, setCsv] = React.useState("");
  const [csvErrors, setCsvErrors] = React.useState<string[]>([]);
  const [csvImported, setCsvImported] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const fxInputs = React.useMemo(
    () => rates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate })),
    [rates]
  );
  const resolved = React.useMemo(
    () => resolveFxRate(from, to, fxInputs),
    [from, to, fxInputs]
  );
  const converted = resolved ? toD(amount || "0").times(resolved.rate) : null;

  const addRate = () => {
    const n = toD(rate);
    if (!base || !quote || base === quote || !n.isFinite() || n.lte(0)) return;
    upsertRate.mutate({
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      rate: n.toString(),
      source: "MANUAL",
      date: new Date().toISOString().slice(0, 10),
    });
    setRate("");
  };

  const importCsv = () => {
    setCsvErrors([]);
    setCsvImported(0);
    importRates.mutate(csv, {
      onSuccess: (result) => {
        setCsvErrors(result.errors);
        setCsvImported(result.imported);
      },
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="space-y-6">
      {isToolsTablesMissing(fxRatesQuery.error) && <ToolsUnavailable />}
      {/* ── Convert ── */}
      <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label htmlFor="fx-amount">{t("converterAmount")}</Label>
          <Input id="fx-amount" type="number" inputMode="decimal" min="0" step="any"
            value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fx-from">{t("converterFrom")}</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger id="fx-from" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONVERTIBLE.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="icon" aria-label={t("converterSwap")} onClick={swap}>
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="space-y-2">
          <Label htmlFor="fx-to">{t("converterTo")}</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="fx-to" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONVERTIBLE.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/40 p-6 text-center">
        {resolved && converted !== null ? (
          <>
            <p className="text-3xl font-bold tabular-nums tracking-tight">
              {fmtNum(converted, 2)} <span className="text-lg text-muted-foreground">{to}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              1 {from} = {fmtNum(resolved.rate, 6)} {to}
              {resolved.triangulated && ` (${t("converterVia", { path: resolved.path.join(" + ") })})`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("converterNoRate")}</p>
        )}
      </div>

      {/* ── Rates table ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("converterRatesTitle")}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24 space-y-1">
            <Label htmlFor="fx-base">{t("converterBase")}</Label>
            <Input id="fx-base" value={base} onChange={(e) => setBase(e.target.value.toUpperCase())}
              maxLength={3} className="uppercase tabular-nums" />
          </div>
          <div className="w-24 space-y-1">
            <Label htmlFor="fx-quote">{t("converterQuote")}</Label>
            <Input id="fx-quote" value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())}
              maxLength={3} className="uppercase tabular-nums" />
          </div>
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor="fx-rate">{t("converterRate")}</Label>
            <Input id="fx-rate" type="number" inputMode="decimal" min="0" step="any"
              value={rate} onChange={(e) => setRate(e.target.value)}
              placeholder={t("converterRatePlaceholder")} className="tabular-nums" />
          </div>
          <Button variant="outline" onClick={addRate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("converterAddRate")}
          </Button>
        </div>
        {rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("converterEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("converterColPair")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("converterColRate")}</th>
                  <th className="px-3 py-2 font-medium">{t("converterColSource")}</th>
                  <th className="px-3 py-2 font-medium">{t("converterColDate")}</th>
                  <th className="px-3 py-2" aria-label={t("converterColDelete")} />
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium tabular-nums">{r.base}{r.quote}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.rate, 6)}</td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2 tabular-nums">{r.date}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="icon"
                        aria-label={t("converterDeleteRate", { pair: `${r.base}${r.quote}` })}
                        onClick={() => deleteRate.mutate(r.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── CSV import ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("converterCsvTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("converterCsvHint")}</p>
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)}
          placeholder={"EUR,USD,1.0850\nUSD,JPY,149.20"} rows={4} className="font-mono text-sm" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={importCsv}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("converterImportCsv")}
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            {t("converterChooseFile")}
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {csvImported > 0 && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {t("converterImported", { count: csvImported })}
          </p>
        )}
        {csvErrors.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("converterCsvErrors", { count: csvErrors.length, lines: csvErrors.slice(0, 3).join(" ; ") })}
          </p>
        )}
      </div>
    </div>
  );
}
