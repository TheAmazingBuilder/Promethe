"use client";

import * as React from "react";
import { Search, CandlestickChart, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  searchCandlestickPatterns,
  type CandlestickPattern,
  type CandlestickPatternBias,
  type CandlestickPatternCategory,
} from "@/lib/gaia/patterns/catalog";
import {
  PatternGlyph,
  getCandlestickPatternCandleCount,
} from "./gaia-pattern-diagram";

export { getCandlestickPatternCandleCount };

const CATEGORY_LABELS: Record<CandlestickPatternCategory, string> = {
  indecision: "Indecision",
  "bullish-reversal": "Bullish reversal",
  "bearish-reversal": "Bearish reversal",
  continuation: "Continuation",
};

function BiasLabel({ bias }: { bias: CandlestickPatternBias }) {
  if (bias === "bullish") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <ArrowUpRight className="size-3" /> Bullish
      </span>
    );
  }
  if (bias === "bearish") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
        <ArrowDownRight className="size-3" /> Bearish
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
      <Minus className="size-3" /> Neutral
    </span>
  );
}

function PatternCard({
  pattern,
  selected,
  onSelect,
}: {
  pattern: CandlestickPattern;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`gaia-pattern-card-${pattern.id}`}
      aria-pressed={selected}
      onClick={onSelect}
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-promethe-gaia-pattern", pattern.id); }}
      className={`min-w-0 rounded-lg border p-3 text-left transition-colors hover:border-emerald-500/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-emerald-500/60 bg-emerald-500/5" : "border-border bg-card"}`}
    >
      <div className="mb-2 flex min-h-14 items-center justify-center rounded-md bg-muted/40 px-2">
        <PatternGlyph patternId={pattern.id} compact />
      </div>
      <span className="block truncate text-sm font-semibold">{pattern.name}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        <BiasLabel bias={pattern.bias} />
        <span className="text-[11px] text-muted-foreground">{pattern.candles} candle{pattern.candles > 1 ? "s" : ""}</span>
      </span>
    </button>
  );
}

function PatternDetails({ pattern }: { pattern: CandlestickPattern }) {
  return (
    <section data-testid="gaia-pattern-details" className="min-w-0 space-y-4">
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-center justify-center rounded-lg bg-background/70 p-3">
          <PatternGlyph patternId={pattern.id} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BiasLabel bias={pattern.bias} />
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            {pattern.candles} candle{pattern.candles > 1 ? "s" : ""}
          </span>
          <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[pattern.category]}</span>
        </div>
        <h3 className="mt-2 text-lg font-semibold">{pattern.name}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{pattern.description}</p>
      </div>
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Market context</h4>
          <p className="mt-1 text-sm leading-relaxed">{pattern.marketContext}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interpretation</h4>
          <p className="mt-1 text-sm leading-relaxed">{pattern.interpretation}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confirmation to watch</h4>
          <p className="mt-1 text-sm leading-relaxed">{pattern.confirmation}</p>
        </div>
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Limitations</h4>
          <p className="mt-1 text-sm leading-relaxed">{pattern.caveats}</p>
        </div>
      </div>
    </section>
  );
}

export function GaiaPatternLibrary({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (patternId: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<CandlestickPatternCategory | "all">("all");
  const [bias, setBias] = React.useState<CandlestickPatternBias | "all">("all");
  const [selectedId, setSelectedId] = React.useState("doji");

  const patterns = React.useMemo(
    () => searchCandlestickPatterns({ query, category, bias }),
    [query, category, bias],
  );
  const selected = patterns.find((pattern) => pattern.id === selectedId) ?? patterns[0] ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(96vw,1040px)] overflow-y-auto p-0 sm:max-w-5xl"
        data-testid="gaia-pattern-library"
      >
        <SheetHeader className="border-b px-5 py-4 pr-14 text-left">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CandlestickChart className="size-5" />
            </span>
            <div>
              <SheetTitle>Japanese candlestick patterns</SheetTitle>
              <SheetDescription>Browse visual references and learn how each pattern is interpreted.</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
          <div className="min-w-0 space-y-4 border-b p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, alias or description…"
                aria-label="Search candlestick patterns"
                className="pl-9"
                data-testid="gaia-pattern-search"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Filter by category">
              <Button size="sm" variant={category === "all" ? "secondary" : "outline"} onClick={() => setCategory("all")}>All</Button>
              {(Object.keys(CATEGORY_LABELS) as CandlestickPatternCategory[]).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={category === value ? "secondary" : "outline"}
                  onClick={() => setCategory(value)}
                >
                  {CATEGORY_LABELS[value]}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-muted-foreground" htmlFor="gaia-pattern-bias">Market bias</label>
              <select
                id="gaia-pattern-bias"
                value={bias}
                onChange={(event) => setBias(event.target.value as CandlestickPatternBias | "all")}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="all">Any bias</option>
                <option value="bullish">Bullish</option>
                <option value="bearish">Bearish</option>
                <option value="neutral">Neutral</option>
              </select>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{patterns.length} results</span>
            </div>

            {patterns.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <p className="text-sm font-medium">No matching patterns</p>
                <p className="mt-1 text-xs text-muted-foreground">Try another keyword or clear the filters.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => { setQuery(""); setCategory("all"); setBias("all"); }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {patterns.map((pattern) => (
                  <PatternCard
                    key={pattern.id}
                    pattern={pattern}
                    selected={selected?.id === pattern.id}
                    onSelect={() => setSelectedId(pattern.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            {selected ? (
              <>
                <PatternDetails pattern={selected} />
                {onInsert ? <Button type="button" size="sm" className="mt-3" onClick={() => { onInsert(selected.id); onOpenChange(false); }}>Insert into note</Button> : null}
              </>
            ) : (
              <div className="flex min-h-64 items-center justify-center text-center text-sm text-muted-foreground">
                Select a pattern to view its details.
              </div>
            )}
          </div>
        </div>
        <div className="border-t bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          Educational reference only. Candlestick patterns are context-dependent observations, not standalone trade signals or financial advice.
        </div>
      </SheetContent>
    </Sheet>
  );
}
