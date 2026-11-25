"use client";

import * as React from "react";
import { History, Loader2, Play, Trash2, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { AdvancedShell } from "./advanced-shell";
import { MonteCarloFanChart } from "./monte-carlo-fan-chart";
import { useAccounts } from "@/hooks/use-trading";
import { useCreateMonteCarloRun, useDeleteMonteCarloRun, useMonteCarloRun, useMonteCarloRuns } from "@/hooks/use-monte-carlo";
import type { MonteCarloRunListItem } from "@/hooks/use-monte-carlo";
import type { MonteCarloResult } from "@/lib/analytics/monte-carlo";

function money(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function sourceLabel(source: string | undefined) {
  return source === "HYPOTHETICAL" ? "Hypothetical outcomes" : "Historical trades";
}

function ruinBehaviorLabel(behavior: string | undefined) {
  // Runs saved before lot 7 have no behavior stored; the engine then
  // always continued after ruin, so they read as CONTINUE.
  return behavior === "STOP" ? "Stop at ruin" : "Continue after ruin";
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function DistributionCard({ title, values, currency, isMoney }: {
  title: string;
  values: { p5: number; p25: number; median: number; p75: number; p95: number };
  currency: string;
  isMoney: boolean;
}) {
  const rows: Array<[string, number]> = [["5th percentile", values.p5], ["25th percentile", values.p25], ["Median", values.median], ["75th percentile", values.p75], ["95th percentile", values.p95]];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>Distribution across all simulated paths</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-medium tabular-nums">{isMoney ? money(value, currency) : `${value.toFixed(1)}%`}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface DisplayedRun {
  id: string;
  name: string;
  createdAt: string;
  currency: string;
  params: {
    accountName: string;
    source: string;
    riskPercent: number;
    iterations: number;
    tradesPerPath: number;
    targetPercent: number;
    ruinThresholdPercent: number;
    ruinBehavior: string;
    hypotheticalWinRate?: number;
    hypotheticalAvgWinR?: number;
    hypotheticalAvgLossR?: number;
    seed: number;
    historicalSampleSize: number;
  };
  result: MonteCarloResult;
}

export function MonteCarloView() {
  const { data: accounts = [] } = useAccounts();
  const createRun = useCreateMonteCarloRun();
  const deleteRun = useDeleteMonteCarloRun();
  const runsQuery = useMonteCarloRuns();
  const runs = runsQuery.data ?? [];
  const eligibleAccounts = accounts.filter((account) => account.isActive);
  const [accountId, setAccountId] = React.useState("");
  const [name, setName] = React.useState("Monte Carlo simulation");
  const [source, setSource] = React.useState<"HISTORICAL" | "HYPOTHETICAL">("HISTORICAL");
  const [riskPercent, setRiskPercent] = React.useState(1);
  const [iterations, setIterations] = React.useState(2000);
  const [tradesPerPath, setTradesPerPath] = React.useState(100);
  const [targetPercent, setTargetPercent] = React.useState(10);
  const [ruinThresholdPercent, setRuinThresholdPercent] = React.useState(30);
  const [ruinBehavior, setRuinBehavior] = React.useState<"STOP" | "CONTINUE">("STOP");
  const [hypoWinRate, setHypoWinRate] = React.useState(55);
  const [hypoAvgWinR, setHypoAvgWinR] = React.useState(1.5);
  const [hypoAvgLossR, setHypoAvgLossR] = React.useState(-1);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const openRun = useMonteCarloRun(openRunId);
  const [compareIds, setCompareIds] = React.useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = React.useState<MonteCarloRunListItem | null>(null);

  const fresh = createRun.data ?? null;
  const opened = openRun.data ?? null;
  const displayed: DisplayedRun | null = opened
    ? {
        id: opened.id,
        name: opened.name,
        createdAt: opened.createdAt,
        currency: opened.params.currency,
        params: {
          accountName: opened.params.accountName,
          source: opened.params.source ?? "HISTORICAL",
          riskPercent: opened.params.riskPercent,
          iterations: opened.params.iterations,
          tradesPerPath: opened.params.tradesPerPath,
          targetPercent: opened.params.targetPercent,
          ruinThresholdPercent: opened.params.ruinThresholdPercent,
          ruinBehavior: opened.params.ruinBehavior ?? "CONTINUE",
          hypotheticalWinRate: opened.params.hypotheticalWinRate,
          hypotheticalAvgWinR: opened.params.hypotheticalAvgWinR,
          hypotheticalAvgLossR: opened.params.hypotheticalAvgLossR,
          seed: opened.params.seed,
          historicalSampleSize: opened.params.historicalSampleSize,
        },
        result: opened.result,
      }
    : fresh
      ? {
          id: fresh.run.id,
          name: fresh.run.name,
          createdAt: fresh.run.createdAt,
          currency: fresh.account.currency,
          params: {
            accountName: fresh.params.accountName,
            source: fresh.params.source,
            riskPercent: fresh.params.riskPercent,
            iterations: fresh.params.iterations,
            tradesPerPath: fresh.params.tradesPerPath,
            targetPercent: fresh.params.targetPercent,
            ruinThresholdPercent: fresh.params.ruinThresholdPercent,
            ruinBehavior: fresh.params.ruinBehavior,
            hypotheticalWinRate: fresh.params.hypotheticalWinRate,
            hypotheticalAvgWinR: fresh.params.hypotheticalAvgWinR,
            hypotheticalAvgLossR: fresh.params.hypotheticalAvgLossR,
            seed: fresh.params.seed,
            historicalSampleSize: fresh.params.historicalSampleSize,
          },
          result: fresh.result,
        }
      : null;

  const result = displayed?.result ?? null;
  const currency = displayed?.currency ?? eligibleAccounts.find((a) => a.id === accountId)?.currency ?? "USD";
  const sampleCount = displayed && (displayed.result.source ?? "HISTORICAL") === "HISTORICAL" ? displayed.result.sampleSize : null;
  const comparedRuns = runs.filter((run) => compareIds.includes(run.id));

  React.useEffect(() => {
    if (!accountId && eligibleAccounts.length > 0) setAccountId(eligibleAccounts[0].id);
  }, [accountId, eligibleAccounts]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountId) return;
    createRun.mutate(
      {
        accountId,
        name: name.trim() || "Monte Carlo simulation",
        source,
        riskPercent,
        iterations,
        tradesPerPath,
        targetPercent,
        ruinThresholdPercent,
        ruinBehavior,
        hypotheticalWinRate: source === "HYPOTHETICAL" ? hypoWinRate : undefined,
        hypotheticalAvgWinR: source === "HYPOTHETICAL" ? hypoAvgWinR : undefined,
        hypotheticalAvgLossR: source === "HYPOTHETICAL" ? hypoAvgLossR : undefined,
        seed: Math.floor(Math.random() * 0xffff_ffff),
      },
      { onSuccess: (payload) => setOpenRunId(payload.run.id) },
    );
  };

  const toggleCompare = (id: string, checked: boolean) => {
    setCompareIds((ids) => (checked ? [...ids, id] : ids.filter((item) => item !== id)));
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    if (openRunId === id) setOpenRunId(null);
    setCompareIds((ids) => ids.filter((item) => item !== id));
    deleteRun.mutate(id);
    setDeleteTarget(null);
  };

  const noAccounts = eligibleAccounts.length === 0;
  return (
    <AdvancedShell
      tab="monte-carlo"
      title="Monte Carlo simulation"
      description="Explore possible account paths by resampling your own closed-trade R-multiples or hypothetical outcomes. This is a statistical scenario tool, not a forecast."
      period="all"
      onPeriodChange={() => undefined}
      accountId="all"
      onAccountChange={() => undefined}
      isLoading={false}
      isError={false}
      onRetry={() => undefined}
      empty={false}
      sampleCount={sampleCount}
      hidePeriod
      hideAccount
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation settings</CardTitle>
            <CardDescription>
              {source === "HISTORICAL"
                ? "Uses at least five closed trades with a valid R-multiple from the selected account."
                : "Uses the account only for its starting balance and currency. Outcomes come from the win rate and average win and loss below, not from your trade history."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="mc-name">Simulation name</Label>
                <Input id="mc-name" type="text" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Trading account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
                  <SelectContent>
                    {eligibleAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name} · {account.currency}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Outcomes source</Label>
                <Select value={source} onValueChange={(value) => setSource(value as "HISTORICAL" | "HYPOTHETICAL")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HISTORICAL">Historical trades</SelectItem>
                    <SelectItem value="HYPOTHETICAL">Hypothetical outcomes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {source === "HYPOTHETICAL" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-winrate">Win rate (%)</Label>
                    <Input id="mc-winrate" type="number" min="0" max="100" step="1" value={hypoWinRate} onChange={(event) => setHypoWinRate(Number(event.target.value))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-avgwin">Average win (R)</Label>
                      <Input id="mc-avgwin" type="number" min="0.1" max="20" step="0.1" value={hypoAvgWinR} onChange={(event) => setHypoAvgWinR(Number(event.target.value))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-avgloss">Average loss (R)</Label>
                      <Input id="mc-avgloss" type="number" min="-20" max="-0.1" step="0.1" value={hypoAvgLossR} onChange={(event) => setHypoAvgLossR(Number(event.target.value))} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Each simulated trade wins {hypoAvgWinR}R with a {hypoWinRate}% chance and loses {hypoAvgLossR}R otherwise. No trade history is used.</p>
                </>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="mc-risk">Risk per trade (%)</Label>
                <Input id="mc-risk" type="number" min="0.1" max="10" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-iterations">Simulation paths</Label>
                <Input id="mc-iterations" type="number" min="100" max="10000" step="100" value={iterations} onChange={(event) => setIterations(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-horizon">Trades per path</Label>
                <Input id="mc-horizon" type="number" min="10" max="500" step="10" value={tradesPerPath} onChange={(event) => setTradesPerPath(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-target">Profit target (%)</Label>
                <Input id="mc-target" type="number" min="0.1" max="500" step="0.5" value={targetPercent} onChange={(event) => setTargetPercent(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mc-ruin">Ruin threshold: loss from starting balance (%)</Label>
                <Input id="mc-ruin" type="number" min="1" max="99" step="1" value={ruinThresholdPercent} onChange={(event) => setRuinThresholdPercent(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>When a path hits the ruin threshold</Label>
                <Select value={ruinBehavior} onValueChange={(value) => setRuinBehavior(value as "STOP" | "CONTINUE")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STOP">Stop at ruin</SelectItem>
                    <SelectItem value="CONTINUE">Continue after ruin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ruinBehavior === "STOP"
                    ? "The path ends at the ruin step. The trader is assumed to stop trading, so a ruined path can no longer recover or reach the target."
                    : "The path keeps trading after ruin and may recover. Ruin is still recorded, but the ending balance and drawdown keep moving."}
                </p>
              </div>
              {createRun.isError ? <p className="text-sm text-destructive">{createRun.error.message}</p> : null}
              <Button type="submit" className="w-full" disabled={noAccounts || createRun.isPending || !accountId}>
                {createRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run simulation
              </Button>
              {noAccounts ? <p className="text-xs text-muted-foreground">Create or activate a trading account before running a simulation.</p> : null}
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {openRun.isPending ? (
            <Card className="h-full">
              <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading saved simulation…</p>
              </CardContent>
            </Card>
          ) : result && displayed ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{displayed.name}</h3>
                <Badge variant="secondary">{sourceLabel(displayed.params.source)}</Badge>
                <Badge variant="outline">{ruinBehaviorLabel(displayed.params.ruinBehavior)}</Badge>
                <span className="text-xs text-muted-foreground">{displayed.params.accountName} · {formatDate(displayed.createdAt)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Risk of ruin" value={`${result.probabilityOfRuin.toFixed(1)}%`} detail={`Drawdown threshold: ${result.ruinThresholdPercent}%`} />
                <Kpi label="Chance to reach target" value={`${result.probabilityOfReachingTarget.toFixed(1)}%`} detail={`Target: +${result.targetPercent}%`} />
                <Kpi label="Median ending balance" value={money(result.endingBalance.median, currency)} detail={`${result.iterations.toLocaleString()} simulated paths`} />
                <Kpi label="Median max drawdown" value={`${result.maxDrawdownPercent.median.toFixed(1)}%`} detail="Peak-to-trough during each path" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <DistributionCard title="Ending balance" values={result.endingBalance} currency={currency} isMoney />
                <DistributionCard title="Maximum drawdown" values={result.maxDrawdownPercent} currency={currency} isMoney={false} />
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Simulated equity paths</CardTitle><CardDescription>Percentile bands of equity across the trades of a path</CardDescription></CardHeader>
                <CardContent>
                  <MonteCarloFanChart
                    bands={result.equityBands ?? []}
                    bandPaths={result.equityBandPaths ?? result.iterations}
                    iterations={result.iterations}
                    startingBalance={result.startingBalance}
                    targetPercent={result.targetPercent}
                    ruinThresholdPercent={result.ruinThresholdPercent}
                    currency={currency}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Ending balance distribution</CardTitle><CardDescription>Frequency of simulated final balances</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  {result.endingBalanceBuckets.map((bucket, index) => {
                    const maxCount = Math.max(...result.endingBalanceBuckets.map((item) => item.count), 1);
                    return (
                      <div key={index} className="grid grid-cols-[100px_1fr_42px] items-center gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{money(bucket.from, currency)}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(bucket.count / maxCount) * 100}%` }} /></div>
                        <span className="text-right tabular-nums">{bucket.count}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground">
                {displayed.params.source === "HYPOTHETICAL"
                  ? `Hypothetical outcomes: ${displayed.params.hypotheticalWinRate}% win rate, +${displayed.params.hypotheticalAvgWinR}R average win, ${displayed.params.hypotheticalAvgLossR}R average loss. No trade history used.`
                  : `Historical sample: ${result.sampleSize} trades.`}{" "}
                {result.riskPercent}% risk per trade · Resampling with replacement · Seed {result.seed}. Results depend on the quality and representativeness of your trade history.
              </p>
            </>
          ) : (
            <Card className="h-full">
              <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
                <div className="rounded-full bg-muted p-3"><TrendingDown className="h-6 w-6 text-muted-foreground" /></div>
                <div className="max-w-md space-y-1">
                  <h3 className="font-medium">Your simulation results will appear here</h3>
                  <p className="text-sm text-muted-foreground">Choose an account and run a simulation to estimate outcome ranges, drawdown risk and the probability of reaching your target, or open a saved simulation below.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Saved simulations</CardTitle>
          <CardDescription>Your last {runs.length === 20 ? "20 " : ""}simulations. Open one to review its saved parameters and results, or tick several to compare them.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading saved simulations…</p>
          ) : runsQuery.isError ? (
            <p className="text-sm text-destructive">Saved simulations could not be loaded.</p>
          ) : runs.length === 0 ? (
            <EmptyState
              title="No saved simulations yet"
              description="Run a simulation above and it will be saved here, with its parameters and results, so you can reopen or compare it later."
            />
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const isOpen = displayed?.id === run.id;
                const checked = compareIds.includes(run.id);
                return (
                  <div key={run.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${isOpen ? "border-primary bg-muted/50" : ""}`}>
                    <Checkbox checked={checked} onCheckedChange={(value) => toggleCompare(run.id, value === true)} aria-label={`Compare ${run.name}`} />
                    <button type="button" onClick={() => setOpenRunId(run.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{run.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(run.createdAt)} · {run.params.accountName}</span>
                    </button>
                    <Badge variant="secondary">{sourceLabel(run.params.source)}</Badge>
                    {run.summary ? (
                      <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
                        Ruin {run.summary.probabilityOfRuin.toFixed(1)}% · Target {run.summary.probabilityOfReachingTarget.toFixed(1)}% · Median {money(run.summary.medianEndingBalance, run.params.currency)}
                      </span>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setOpenRunId(run.id)} disabled={isOpen}>{isOpen ? "Opened" : "Open"}</Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${run.name}`} disabled={deleteRun.isPending} onClick={() => setDeleteTarget(run)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {compareIds.length > 0 && comparedRuns.length < 2 ? (
                <p className="text-xs text-muted-foreground">Tick at least one more simulation to compare them side by side.</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {comparedRuns.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compare simulations</CardTitle>
            <CardDescription>Parameters and saved results, side by side. Nothing here is a prediction: the same past can produce very different simulated futures.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3 font-medium text-muted-foreground">Metric</th>
                  {comparedRuns.map((run) => (
                    <th key={run.id} className="py-2 pr-3 font-medium">{run.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Outcomes", (run: MonteCarloRunListItem) => sourceLabel(run.params.source)],
                    ["Account", (run: MonteCarloRunListItem) => run.params.accountName],
                    ["Risk per trade", (run: MonteCarloRunListItem) => `${run.params.riskPercent}%`],
                    ["Paths", (run: MonteCarloRunListItem) => run.params.iterations.toLocaleString()],
                    ["Trades per path", (run: MonteCarloRunListItem) => String(run.params.tradesPerPath)],
                    ["Target", (run: MonteCarloRunListItem) => `+${run.params.targetPercent}%`],
                    ["Ruin threshold", (run: MonteCarloRunListItem) => `${run.params.ruinThresholdPercent}%`],
                    ["Ruin behavior", (run: MonteCarloRunListItem) => ruinBehaviorLabel(run.params.ruinBehavior)],
                    ["Historical sample", (run: MonteCarloRunListItem) => run.params.source === "HYPOTHETICAL" ? "—" : `${run.params.historicalSampleSize} trades`],
                    ["Win rate", (run: MonteCarloRunListItem) => run.params.source === "HYPOTHETICAL" ? `${run.params.hypotheticalWinRate}%` : "—"],
                    ["Avg win / loss", (run: MonteCarloRunListItem) => run.params.source === "HYPOTHETICAL" ? `+${run.params.hypotheticalAvgWinR}R / ${run.params.hypotheticalAvgLossR}R` : "—"],
                    ["Risk of ruin", (run: MonteCarloRunListItem) => run.summary ? `${run.summary.probabilityOfRuin.toFixed(1)}%` : "—"],
                    ["Chance to reach target", (run: MonteCarloRunListItem) => run.summary ? `${run.summary.probabilityOfReachingTarget.toFixed(1)}%` : "—"],
                    ["Median ending balance", (run: MonteCarloRunListItem) => run.summary ? money(run.summary.medianEndingBalance, run.params.currency) : "—"],
                    ["5th percentile ending balance", (run: MonteCarloRunListItem) => run.summary?.p5EndingBalance != null ? money(run.summary.p5EndingBalance, run.params.currency) : "—"],
                    ["95th percentile ending balance", (run: MonteCarloRunListItem) => run.summary?.p95EndingBalance != null ? money(run.summary.p95EndingBalance, run.params.currency) : "—"],
                    ["Median max drawdown", (run: MonteCarloRunListItem) => run.summary ? `${run.summary.medianMaxDrawdown.toFixed(1)}%` : "—"],
                  ] as Array<[string, (run: MonteCarloRunListItem) => string]>
                ).map(([label, get]) => (
                  <tr key={label} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{label}</td>
                    {comparedRuns.map((run) => (
                      <td key={run.id} className="py-2 pr-3 tabular-nums">{get(run)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Method and limits</CardTitle>
          <CardDescription>How the numbers are produced, and what they cannot tell you</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Historical simulations resample your closed-trade R-multiples with replacement: every simulated trade draws one of your past outcomes at random.
            Hypothetical simulations draw each trade from your win rate and average win and loss instead, without using any trade history.
            Each trade risks a fixed percentage of the current equity, so position size compounds with the account.
          </p>
          <p>
            Ruin means the equity drawdown from the starting balance reached the ruin threshold. With &ldquo;Stop at ruin&rdquo; the path ends there, as if the trader stopped trading;
            with &ldquo;Continue after ruin&rdquo; the path keeps trading and may recover, while still counting as ruined.
            The risk of ruin is the share of paths that touched the threshold at least once.
          </p>
          <p>
            Limits: the quality of a historical simulation depends on the size and representativeness of your trade sample — a handful of trades cannot describe the range of future outcomes.
            Fees, spread, slippage and changing position sizes are not modeled. The same seed always reproduces the same run, so a saved simulation can be checked, not because the future is fixed.
            A simulation explores ranges of outcomes. It does not predict what will happen.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this simulation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `"${deleteTarget.name}"` : "This simulation"} will be permanently deleted, including its saved parameters and results. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdvancedShell>
  );
}
