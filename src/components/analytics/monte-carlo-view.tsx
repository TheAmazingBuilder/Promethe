"use client";

import * as React from "react";
import { Loader2, Play, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdvancedShell } from "./advanced-shell";
import { useAccounts } from "@/hooks/use-trading";
import { useCreateMonteCarloRun } from "@/hooks/use-monte-carlo";
import type { MonteCarloResult } from "@/lib/analytics/monte-carlo";

function money(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
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

export function MonteCarloView() {
  const { data: accounts = [] } = useAccounts();
  const createRun = useCreateMonteCarloRun();
  const eligibleAccounts = accounts.filter((account) => account.isActive);
  const [accountId, setAccountId] = React.useState("");
  const [riskPercent, setRiskPercent] = React.useState(1);
  const [iterations, setIterations] = React.useState(2000);
  const [tradesPerPath, setTradesPerPath] = React.useState(100);
  const [targetPercent, setTargetPercent] = React.useState(10);
  const [ruinThresholdPercent, setRuinThresholdPercent] = React.useState(30);
  const result: MonteCarloResult | null = createRun.data?.result ?? null;
  const currency = createRun.data?.account.currency ?? eligibleAccounts.find((a) => a.id === accountId)?.currency ?? "USD";

  React.useEffect(() => {
    if (!accountId && eligibleAccounts.length > 0) setAccountId(eligibleAccounts[0].id);
  }, [accountId, eligibleAccounts]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountId) return;
    createRun.mutate({
      accountId,
      name: "Monte Carlo simulation",
      riskPercent,
      iterations,
      tradesPerPath,
      targetPercent,
      ruinThresholdPercent,
      seed: Math.floor(Math.random() * 0xffff_ffff),
    });
  };

  const noAccounts = eligibleAccounts.length === 0;
  return (
    <AdvancedShell
      tab="monte-carlo"
      title="Monte Carlo simulation"
      description="Explore possible account paths by resampling your own closed-trade R-multiples. This is a statistical scenario tool, not a forecast."
      period="all"
      onPeriodChange={() => undefined}
      accountId="all"
      onAccountChange={() => undefined}
      isLoading={false}
      isError={false}
      onRetry={() => undefined}
      empty={false}
      sampleCount={result?.sampleSize ?? null}
      hidePeriod
      hideAccount
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation settings</CardTitle>
            <CardDescription>Uses at least five closed trades with a valid R-multiple from the selected account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
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
          {result ? (
            <>
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
              <p className="text-xs text-muted-foreground">Historical sample: {result.sampleSize} trades · {result.riskPercent}% risk per trade · Resampling with replacement · Seed {result.seed}. Results depend on the quality and representativeness of your trade history.</p>
            </>
          ) : (
            <Card className="h-full">
              <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
                <div className="rounded-full bg-muted p-3"><TrendingDown className="h-6 w-6 text-muted-foreground" /></div>
                <div className="max-w-md space-y-1">
                  <h3 className="font-medium">Your simulation results will appear here</h3>
                  <p className="text-sm text-muted-foreground">Choose an account and run a simulation to estimate outcome ranges, drawdown risk and the probability of reaching your target.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AdvancedShell>
  );
}
