"use client";

/**
 * Risk / Reward calculator - /tools, tab "Risk / Reward".
 *
 * - Interactive R:R × win-rate table (1:1–5:1 × 20–60%), coloured
 *   Profitable / Break Even / Not Profitable like the reference image,
 *   with the break-even cell outlined and the user's own stats overlaid
 *   ("You" marker, with the sample size n - real trades only, never
 *   invented numbers; no closed trades → an honest empty state).
 * - Required win rate for a chosen R:R: 1 / (1 + RR).
 * - Expectancy in R and in $ for a given win rate / R:R / risk per
 *   trade, with scenarios persisted via ToolScenario (kind RISK_REWARD).
 * - Daily risk-budget editor (budget % of balance, stored in the
 *   profile preferences) with the live gauge from the summary API.
 * - Compounding projection (bonus): monthly balances, clearly labelled
 *   as a projection, not a promise.
 *
 * All math goes through the pure decimal engine in
 * src/lib/trading/calculate.ts - never JS floats.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  classifyRrCell,
  compoundProjection,
  expectancyMoney,
  expectancyR,
  requiredWinRate,
  RR_TABLE_RATIOS,
  RR_TABLE_WIN_RATES,
  type RrCellStatus,
} from "@/lib/trading/calculate";
import { toD } from "@/lib/trading/dec";
import { fmtNum } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import {
  useCreateToolScenario,
  useDeleteToolScenario,
  useToolScenarios,
} from "@/hooks/use-tools";
import {
  useRiskRewardSummary,
  useSetDailyRiskBudget,
} from "@/hooks/use-risk-reward";
import { Stat } from "./shared";

const CELL_TONE: Record<RrCellStatus, string> = {
  profitable:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/25",
  breakeven:
    "bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25",
  losing: "bg-red-500/15 text-red-800 dark:text-red-300 hover:bg-red-500/25",
};

function parsePositive(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function RiskRewardCalculator() {
  const t = useTranslations("tools");
  const fmt = useFormat();
  const summaryQuery = useRiskRewardSummary();
  const summary = summaryQuery.data ?? null;
  const currency = summary?.currency ?? "USD";

  const scenariosQuery = useToolScenarios("RISK_REWARD");
  const scenarios = scenariosQuery.data ?? [];
  const createScenario = useCreateToolScenario();
  const deleteScenario = useDeleteToolScenario();
  const setBudget = useSetDailyRiskBudget();

  // ── Shared inputs ──────────────────────────────────────────────────────────
  const realWinRate = summary?.realStats.winRate;
  const realAvgRR = summary?.realStats.avgPlannedRR;
  const [rr, setRr] = React.useState("2");
  const [winRatePct, setWinRatePct] = React.useState(() =>
    realWinRate != null ? String(Math.round(Number(realWinRate) * 100)) : "40"
  );
  const [riskPerTrade, setRiskPerTrade] = React.useState("100");
  const [scenarioName, setScenarioName] = React.useState("");
  const [budgetPct, setBudgetPct] = React.useState("");
  const [compoundStart, setCompoundStart] = React.useState("");
  const [compoundExpR, setCompoundExpR] = React.useState("");
  const [compoundRiskPct, setCompoundRiskPct] = React.useState("1");
  const [compoundTrades, setCompoundTrades] = React.useState("20");
  const [compoundMonths, setCompoundMonths] = React.useState("12");

  // Prefill from the live summary once it arrives (user edits win).
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (prefilled.current || !summary) return;
    prefilled.current = true;
    if (summary.realStats.winRate != null) {
      setWinRatePct(String(Math.round(Number(summary.realStats.winRate) * 100)));
    }
    if (summary.realStats.avgPlannedRR != null) {
      setRr(String(Number(summary.realStats.avgPlannedRR)));
    }
    if (summary.budget.percent != null) setBudgetPct(summary.budget.percent);
    if (Number(summary.balance) > 0) setCompoundStart(summary.balance);
    if (summary.realStats.expectancyR != null) {
      setCompoundExpR(summary.realStats.expectancyR);
    }
  }, [summary]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const rrNum = parsePositive(rr);
  const winRateNum =
    winRatePct.trim() === "" ? null : Number(winRatePct);
  const winRateFrac =
    winRateNum != null && winRateNum >= 0 && winRateNum <= 100
      ? winRateNum / 100
      : null;
  const required = rrNum != null ? requiredWinRate(rrNum) : null;
  const expR =
    winRateFrac != null && rrNum != null
      ? expectancyR(winRateFrac, rrNum)
      : null;
  const riskNum = parsePositive(riskPerTrade);
  const expMoney =
    winRateFrac != null && rrNum != null && riskNum != null
      ? expectancyMoney({
          winRate: winRateFrac,
          avgWin: toD(rrNum).times(riskNum).toString(),
          avgLoss: riskNum.toString(),
        })
      : null;

  // "You" marker: nearest table row (avg planned R:R) and column (win rate).
  const youRow =
    realAvgRR != null
      ? Math.min(5, Math.max(1, Math.round(Number(realAvgRR))))
      : null;
  const youCol =
    realWinRate != null
      ? RR_TABLE_WIN_RATES.reduce((best, col) =>
          Math.abs(col - Number(realWinRate)) <
          Math.abs(best - Number(realWinRate))
            ? col
            : best
        )
      : null;
  const closedN = summary?.realStats.closedTrades ?? 0;

  const projection = React.useMemo(() => {
    const start = parsePositive(compoundStart);
    const exp = compoundExpR.trim() === "" ? null : Number(compoundExpR);
    const riskPct = parsePositive(compoundRiskPct);
    const trades = parsePositive(compoundTrades);
    const months = parsePositive(compoundMonths);
    if (
      start == null ||
      exp == null ||
      !Number.isFinite(exp) ||
      riskPct == null ||
      trades == null ||
      months == null
    ) {
      return [];
    }
    return compoundProjection({
      startingBalance: start.toString(),
      expectancyR: exp.toString(),
      riskPerTrade: (riskPct / 100).toString(),
      tradesPerMonth: trades.toString(),
      months: months.toString(),
    });
  }, [compoundStart, compoundExpR, compoundRiskPct, compoundTrades, compoundMonths]);

  const saveScenario = () => {
    if (!scenarioName.trim() || winRateFrac == null || rrNum == null) return;
    createScenario.mutate({
      name: scenarioName.trim(),
      kind: "RISK_REWARD",
      payload: {
        winRate: winRateFrac.toString(),
        rr: rrNum.toString(),
        riskPerTrade: riskPerTrade.trim(),
        currency,
      },
    });
    setScenarioName("");
  };

  const loadScenario = (payload: Record<string, unknown>) => {
    if (typeof payload.winRate === "string") {
      setWinRatePct(String(Math.round(Number(payload.winRate) * 100)));
    }
    if (typeof payload.rr === "string") setRr(payload.rr);
    if (typeof payload.riskPerTrade === "string") {
      setRiskPerTrade(payload.riskPerTrade);
    }
  };

  const saveBudget = () => {
    const v = budgetPct.trim();
    if (v === "") return;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    setBudget.mutate(v);
  };

  return (
    <div className="space-y-8">
      {summaryQuery.isError ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {t("rrLoadError")}
        </p>
      ) : null}

      {/* ── Interactive table ─────────────────────────────────────────────── */}
      <section aria-labelledby="rr-table-title" className="space-y-3">
        <div>
          <h3 id="rr-table-title" className="text-sm font-semibold">
            {t("rrTableTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("rrTableDesc")}</p>
        </div>
        {summary && closedN === 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            {t("rrNoTrades")}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-1 text-center">
            <caption className="sr-only">{t("rrTableTitle")}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-16 text-left text-xs font-medium text-muted-foreground">
                  {t("rrTableRowLabel")}
                </th>
                {RR_TABLE_WIN_RATES.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className="text-sm font-semibold tabular-nums"
                  >
                    {Math.round(col * 100)}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RR_TABLE_RATIOS.map((rowRr) => {
                const selected = rrNum === rowRr;
                return (
                  <tr key={rowRr}>
                    <th scope="row" className="text-left">
                      <button
                        type="button"
                        onClick={() => setRr(String(rowRr))}
                        aria-pressed={selected}
                        aria-label={t("rrSelectRow", { rr: rowRr })}
                        className={`rounded-md px-2 py-2 text-sm font-semibold tabular-nums transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                          selected ? "bg-muted ring-2 ring-primary" : ""
                        }`}
                      >
                        {rowRr}:1
                      </button>
                    </th>
                    {RR_TABLE_WIN_RATES.map((col) => {
                      const status = classifyRrCell(rowRr, col);
                      const e = expectancyR(col, rowRr);
                      const isBreakEven = status === "breakeven";
                      const isYou = youRow === rowRr && youCol === col;
                      return (
                        <td
                          key={col}
                          className={`rounded-md px-2 py-2 transition-colors ${CELL_TONE[status]} ${
                            isBreakEven ? "ring-2 ring-amber-500" : ""
                          } ${selected ? "ring-1 ring-inset ring-primary/40" : ""}`}
                        >
                          <span className="block text-sm font-medium">
                            {t(`rrCell${status === "profitable" ? "Profitable" : status === "breakeven" ? "Breakeven" : "Losing"}`)}
                          </span>
                          <span className="block text-xs tabular-nums opacity-80">
                            {e != null
                              ? `${e.gt(0) ? "+" : ""}${fmtNum(e.toNumber(), 2)} R`
                              : "-"}
                          </span>
                          {isYou ? (
                            <Badge variant="secondary" className="mt-1">
                              {t("rrYourStats", { n: closedN })}
                            </Badge>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {summary && closedN > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("rrYourStatsLine", {
              winRate:
                realWinRate != null
                  ? fmtNum(Number(realWinRate) * 100, 1)
                  : "-",
              avgRR:
                realAvgRR != null ? fmtNum(Number(realAvgRR), 2) : "-",
              n: closedN,
            })}
          </p>
        ) : null}
      </section>

      {/* ── Required win rate + expectancy ────────────────────────────────── */}
      <section aria-labelledby="rr-required-title" className="space-y-3">
        <div>
          <h3 id="rr-required-title" className="text-sm font-semibold">
            {t("rrRequiredTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("rrRequiredDesc")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rr-rr">{t("rrInputLabel")}</Label>
            <Input
              id="rr-rr"
              inputMode="decimal"
              value={rr}
              onChange={(e) => setRr(e.target.value)}
              placeholder="2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-winrate">{t("rrWinRateInputLabel")}</Label>
            <Input
              id="rr-winrate"
              inputMode="decimal"
              value={winRatePct}
              onChange={(e) => setWinRatePct(e.target.value)}
              placeholder="40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-risk">{t("rrRiskPerTradeLabel", { currency })}</Label>
            <Input
              id="rr-risk"
              inputMode="decimal"
              value={riskPerTrade}
              onChange={(e) => setRiskPerTrade(e.target.value)}
              placeholder="100"
            />
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={t("rrRequiredResult")}
            value={
              required != null
                ? `${fmtNum(required.times(100).toNumber(), 1)}%`
                : "-"
            }
            hint={t("rrRequiredHint", { rr: rrNum ?? "-" })}
          />
          <Stat
            label={t("rrExpectancyR")}
            value={expR != null ? `${fmtNum(expR.toNumber(), 2)} R` : "-"}
            hint={t("rrPerTrade")}
          />
          <Stat
            label={t("rrExpectancyMoney")}
            value={
              expMoney != null ? fmt.money(expMoney.toString(), currency) : "-"
            }
            hint={
              expMoney != null
                ? t("rrPer100Trades", {
                    amount: fmt.money(expMoney.times(100).toString(), currency),
                  })
                : t("rrPerTrade")
            }
          />
        </dl>
        {required != null && realWinRate != null ? (
          <p className="text-sm text-muted-foreground">
            {Number(realWinRate) >= required.toNumber()
              ? t("rrYouAbove", {
                  winRate: fmtNum(Number(realWinRate) * 100, 1),
                  required: fmtNum(required.times(100).toNumber(), 1),
                })
              : t("rrYouBelow", {
                  winRate: fmtNum(Number(realWinRate) * 100, 1),
                  required: fmtNum(required.times(100).toNumber(), 1),
                })}
          </p>
        ) : null}
      </section>

      {/* ── Saved expectancy scenarios ────────────────────────────────────── */}
      <section aria-labelledby="rr-scenarios-title" className="space-y-3">
        <div>
          <h3 id="rr-scenarios-title" className="text-sm font-semibold">
            {t("rrScenariosTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("rrScenariosDesc")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder={t("rrScenarioNamePlaceholder")}
            aria-label={t("rrScenarioName")}
            className="sm:max-w-xs"
          />
          <Button
            onClick={saveScenario}
            disabled={
              !scenarioName.trim() ||
              winRateFrac == null ||
              rrNum == null ||
              createScenario.isPending
            }
          >
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("rrSaveScenario")}
          </Button>
        </div>
        {scenarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rrScenarioEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {scenarios.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
              >
                <button
                  type="button"
                  onClick={() => loadScenario(s.payload)}
                  className="text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {s.name}
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {typeof s.payload.winRate === "string"
                    ? `${fmtNum(Number(s.payload.winRate) * 100, 0)}%`
                    : "-"}
                  {" · "}
                  {typeof s.payload.rr === "string" ? `${s.payload.rr}:1` : "-"}
                  {" · "}
                  {typeof s.payload.riskPerTrade === "string"
                    ? fmt.money(s.payload.riskPerTrade, currency)
                    : "-"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8"
                  onClick={() => deleteScenario.mutate(s.id)}
                  aria-label={t("rrDeleteScenario", { name: s.name })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Daily risk budget ─────────────────────────────────────────────── */}
      <section aria-labelledby="rr-budget-title" className="space-y-3">
        <div>
          <h3 id="rr-budget-title" className="text-sm font-semibold">
            {t("rrBudgetTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("rrBudgetDesc")}</p>
        </div>
        {summaryQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t("rrLoading")}</p>
        ) : summary ? (
          <div className="space-y-3">
            <dl className="grid gap-3 sm:grid-cols-4">
              <Stat
                label={t("rrBudgetAmount")}
                value={
                  summary.budget.amount != null
                    ? fmt.money(summary.budget.amount, currency)
                    : "-"
                }
                hint={
                  summary.budget.percent != null
                    ? `${fmtNum(Number(summary.budget.percent), 2)}% ${t("rrBudgetOfBalance")}`
                    : t("rrBudgetNotSet")
                }
              />
              <Stat
                label={t("rrBudgetConsumed")}
                value={fmt.money(summary.today.consumed, currency)}
                hint={t("rrBudgetConsumedHint", {
                  open: fmt.money(summary.today.openRisk, currency),
                  loss: fmt.money(summary.today.realizedLossToday, currency),
                })}
              />
              <Stat
                label={t("rrBudgetRemaining")}
                value={
                  summary.today.remaining != null
                    ? fmt.money(summary.today.remaining, currency)
                    : "-"
                }
                hint={
                  summary.today.usedPercent != null
                    ? t("rrBudgetUsed", {
                        pct: fmtNum(summary.today.usedPercent * 100, 0),
                      })
                    : undefined
                }
              />
              <Stat
                label={t("rrBudgetTodayPnl")}
                value={fmt.money(summary.today.realizedPnlToday, currency)}
                hint={t("rrBudgetTodayHint", { day: summary.tradingDay })}
              />
            </dl>
            {summary.budget.isSet && summary.today.usedPercent != null ? (
              <Progress
                value={Math.min(100, summary.today.usedPercent * 100)}
                aria-label={t("rrBudgetUsed", {
                  pct: fmtNum(summary.today.usedPercent * 100, 0),
                })}
              />
            ) : null}
            {summary.budget.isSet &&
            summary.today.usedPercent != null &&
            summary.today.usedPercent >= 1 ? (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                {t("rrBudgetOver")}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("rrBudgetNote")}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="rr-budget-pct">{t("rrBudgetPercentLabel")}</Label>
            <Input
              id="rr-budget-pct"
              inputMode="decimal"
              value={budgetPct}
              onChange={(e) => setBudgetPct(e.target.value)}
              placeholder="2"
              className="sm:w-32"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={saveBudget}
              disabled={budgetPct.trim() === "" || setBudget.isPending}
            >
              {t("rrBudgetSave")}
            </Button>
            {summary?.budget.isSet ? (
              <Button
                variant="outline"
                onClick={() => {
                  setBudget.mutate(null);
                  setBudgetPct("");
                }}
                disabled={setBudget.isPending}
              >
                {t("rrBudgetClear")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Compounding projection (bonus) ────────────────────────────────── */}
      <section aria-labelledby="rr-compound-title" className="space-y-3">
        <div>
          <h3 id="rr-compound-title" className="text-sm font-semibold">
            {t("rrCompoundTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("rrCompoundDesc")}</p>
        </div>
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t("rrCompoundWarning")}
        </p>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="rr-cmp-start">{t("rrCompoundStart", { currency })}</Label>
            <Input
              id="rr-cmp-start"
              inputMode="decimal"
              value={compoundStart}
              onChange={(e) => setCompoundStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-cmp-exp">{t("rrCompoundExpectancyR")}</Label>
            <Input
              id="rr-cmp-exp"
              inputMode="decimal"
              value={compoundExpR}
              onChange={(e) => setCompoundExpR(e.target.value)}
              placeholder="0.2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-cmp-risk">{t("rrCompoundRiskPerTrade")}</Label>
            <Input
              id="rr-cmp-risk"
              inputMode="decimal"
              value={compoundRiskPct}
              onChange={(e) => setCompoundRiskPct(e.target.value)}
              placeholder="1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-cmp-trades">{t("rrCompoundTradesPerMonth")}</Label>
            <Input
              id="rr-cmp-trades"
              inputMode="decimal"
              value={compoundTrades}
              onChange={(e) => setCompoundTrades(e.target.value)}
              placeholder="20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-cmp-months">{t("rrCompoundMonths")}</Label>
            <Input
              id="rr-cmp-months"
              inputMode="decimal"
              value={compoundMonths}
              onChange={(e) => setCompoundMonths(e.target.value)}
              placeholder="12"
            />
          </div>
        </div>
        {projection.length > 1 ? (
          <div className="space-y-2">
            <p className="text-sm">
              {t("rrCompoundResult", {
                final: fmt.money(
                  projection[projection.length - 1].toString(),
                  currency
                ),
                growth: fmtNum(
                  projection[projection.length - 1]
                    .div(projection[0])
                    .minus(1)
                    .times(100)
                    .toNumber(),
                  1
                ),
              })}
            </p>
            <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
              {projection.slice(1).map((bal, i) => (
                <div
                  key={i}
                  className="flex justify-between rounded-lg border px-3 py-2 text-sm tabular-nums"
                >
                  <span className="text-muted-foreground">
                    {t("rrCompoundMonth", { n: i + 1 })}
                  </span>
                  <span className="font-medium">
                    {fmt.money(bal.toString(), currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("rrCompoundEmpty")}</p>
        )}
      </section>
    </div>
  );
}
