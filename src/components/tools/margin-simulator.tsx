/**
 * v2.5 Module 5 (b) - leverage & margin simulator.
 *
 * Account leverage (Account.leverage) is the default; margin call and
 * stop-out levels default to 100% / 50% (overridable per account in the
 * schema, editable here for the simulation). The what-if row adds a
 * hypothetical position and shows the impact on free margin and level.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Plus, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useAccounts, useUpdateAccount } from "@/hooks/use-trading";
import { isToolsTablesMissing, useFxRates } from "@/hooks/use-tools";
import { calcMargin } from "@/lib/tools/margin";
import { D0 } from "@/lib/trading/dec";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { fmtNum } from "@/lib/format";
import { InstrumentSelect, Stat, ToolsUnavailable } from "./shared";

interface MarginRow {
  symbol: string;
  lots: string;
  entry: string;
  hypothetical: boolean;
}

export function MarginSimulator() {
  const t = useTranslations("tools");
  const { data: accounts } = useAccounts();
  const updateAccount = useUpdateAccount();
  const fxRatesQuery = useFxRates();
  const fxRates = fxRatesQuery.data ?? [];

  const [accountId, setAccountId] = React.useState("");
  const [equity, setEquity] = React.useState("10000");
  const [leverage, setLeverage] = React.useState("100");
  const [marginCall, setMarginCall] = React.useState("100");
  const [stopOut, setStopOut] = React.useState("50");
  const [rows, setRows] = React.useState<MarginRow[]>([
    { symbol: "XAUUSD", lots: "1", entry: "2345.00", hypothetical: false },
  ]);

  const account = accounts?.find((a) => a.id === accountId) ?? accounts?.[0];

  // Prefill from the selected account when it changes (levels default to
  // 100% / 50% when the account has none stored).
  React.useEffect(() => {
    if (!account) return;
    setEquity(account.initialBalance);
    if (account.leverage) setLeverage(String(account.leverage));
    setMarginCall(account.marginCallLevel ?? "100");
    setStopOut(account.stopOutLevel ?? "50");
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const levelsChanged =
    account !== undefined &&
    (marginCall !== (account.marginCallLevel ?? "100") ||
      stopOut !== (account.stopOutLevel ?? "50"));

  const currency = account?.currency ?? "USD";

  const result = React.useMemo(() => {
    return calcMargin({
      equity: equity === "" ? "0" : equity,
      balance: equity === "" ? "0" : equity,
      leverage: leverage === "" ? "1" : leverage,
      marginCallLevel: marginCall === "" ? null : marginCall,
      stopOutLevel: stopOut === "" ? null : stopOut,
      accountCurrency: currency,
      fxRates: fxRates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate })),
      positions: rows
        .filter((r) => r.lots !== "" && r.entry !== "")
        .map((r) => {
          const instrument =
            PRESET_INSTRUMENTS.find((i) => i.symbol === r.symbol) ?? PRESET_INSTRUMENTS[0];
          return {
            symbol: r.symbol,
            instrument,
            lots: r.lots,
            entry: r.entry,
            hypothetical: r.hypothetical,
          };
        }),
    });
  }, [equity, leverage, marginCall, stopOut, rows, currency, fxRates]);

  const setRow = (index: number, patch: Partial<MarginRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-6">
      {isToolsTablesMissing(fxRatesQuery.error) && <ToolsUnavailable />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="mg-account">{t("marginAccount")}</Label>
          <Select
            value={account?.id ?? ""}
            onValueChange={(v) => setAccountId(v)}
          >
            <SelectTrigger id="mg-account" className="w-full">
              <SelectValue placeholder={t("marginAccountPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(accounts ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mg-equity">{t("marginEquity")}</Label>
          <Input id="mg-equity" type="number" inputMode="decimal" min="0" step="any"
            value={equity} onChange={(e) => setEquity(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mg-leverage">{t("marginLeverage")}</Label>
          <Input id="mg-leverage" type="number" inputMode="decimal" min="1" step="any"
            value={leverage} onChange={(e) => setLeverage(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mg-mc">{t("marginCallLevel")}</Label>
          <div className="flex gap-2">
            <Input id="mg-mc" type="number" inputMode="decimal" min="0" step="any"
              value={marginCall} onChange={(e) => setMarginCall(e.target.value)} className="tabular-nums" />
            <Input aria-label={t("marginStopOutLevel")} type="number" inputMode="decimal" min="0" step="any"
              value={stopOut} onChange={(e) => setStopOut(e.target.value)} className="w-20 tabular-nums" />
          </div>
          <p className="text-xs text-muted-foreground">{t("marginLevelsHint")}</p>
          {levelsChanged && (
            <Button variant="outline" size="sm"
              disabled={updateAccount.isPending}
              onClick={() =>
                account &&
                updateAccount.mutate({
                  id: account.id,
                  patch: { marginCallLevel: marginCall, stopOutLevel: stopOut },
                })
              }>
              {t("marginSaveLevels")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Positions ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("marginPositions")}</Label>
          <Button variant="outline" size="sm"
            onClick={() => setRows((prev) => [...prev, { symbol: "EURUSD", lots: "1", entry: "1.0850", hypothetical: true }])}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("marginAddPosition")}
          </Button>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_120px_140px_auto_auto]">
            <InstrumentSelect id={`mg-sym-${i}`} value={row.symbol}
              onChange={(v) => setRow(i, { symbol: v })} />
            <div className="space-y-2">
              <Label htmlFor={`mg-lots-${i}`}>{t("lots")}</Label>
              <Input id={`mg-lots-${i}`} type="number" inputMode="decimal" min="0" step="any"
                value={row.lots} onChange={(e) => setRow(i, { lots: e.target.value })} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`mg-entry-${i}`}>{t("entry")}</Label>
              <Input id={`mg-entry-${i}`} type="number" inputMode="decimal" step="any"
                value={row.entry} onChange={(e) => setRow(i, { entry: e.target.value })} className="tabular-nums" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={row.hypothetical}
                onCheckedChange={(v) => setRow(i, { hypothetical: v })} />
              {t("marginWhatIf")}
            </label>
            <Button variant="ghost" size="icon" aria-label={t("marginRemovePosition", { n: i + 1 })}
              disabled={rows.length <= 1}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>

      {/* ── Results ── */}
      {!result.valid && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {result.reason === "MISSING_CONVERSION_RATE"
            ? t("marginMissingFx", { symbols: result.missingFxSymbols.join(", ") })
            : t("marginInvalidInput")}
        </p>
      )}
      {result.valid && (result.marginCall || result.stopOut) && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {result.stopOut ? t("marginStopOutAlert") : t("marginCallAlert")}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t("marginUsed")} value={result.valid && result.usedMargin !== null ? `${fmtNum(result.usedMargin, 2)} ${currency}` : "—"} />
        <Stat label={t("marginFree")} value={result.valid && result.freeMargin !== null ? `${fmtNum(result.freeMargin, 2)} ${currency}` : "—"} />
        <Stat
          label={t("marginLevel")}
          value={result.marginLevel !== null ? `${fmtNum(result.marginLevel, 0)} %` : "-"}
        />
        <Stat
          label={t("marginDistanceCall")}
          value={result.distanceToMarginCall !== null ? `${fmtNum(result.distanceToMarginCall, 2)} ${currency}` : "-"}
        />
        <Stat
          label={t("marginDistanceStopOut")}
          value={result.distanceToStopOut !== null ? `${fmtNum(result.distanceToStopOut, 2)} ${currency}` : "-"}
        />
        <Stat
          label={t("marginNotional")}
          value={result.valid ? `${fmtNum(result.positions.reduce((acc, p) => acc.plus(p.notional ?? D0), D0), 2)} ${currency}` : "—"}
        />
      </dl>

      {result.positions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("instrument")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("lots")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("notional")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("marginUsed")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("marginWhatIf")}</th>
              </tr>
            </thead>
            <tbody>
              {result.positions.map((p, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium tabular-nums">{p.symbol}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.lots, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.notional !== null ? fmtNum(p.notional, 2) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.requiredMargin !== null ? fmtNum(p.requiredMargin, 2) : "—"}</td>
                  <td className="px-3 py-2 text-right">{p.hypothetical ? t("yes") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
