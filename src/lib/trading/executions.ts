/**
 * Aggregation of multiple executions (scale-ins / partial exits).
 *
 * When a Trade has executions, its aggregates (average entry, average exit,
 * realized P&L) are derived from this function using the weighted-average
 * cost method:
 *   - ENTRY / ADD increase the cost basis (weighted average entry price).
 *   - PARTIAL_EXIT / FINAL_EXIT realize P&L against the running average cost
 *     and reduce the basis.
 *   - Commission (signed cost) is summed.
 */
import { D0, Decimal, toD, type DecimalInput } from "./dec";
import { priceDiff } from "./calculate";
import type { Direction, ExecutionType, InstrumentSpec } from "./types";

export interface ExecutionLike {
  type: string; // ExecutionType (kept loose for CSV rows / form drafts)
  time: Date | string | number;
  price: DecimalInput;
  lots: DecimalInput;
  commission?: DecimalInput;
}

export interface ExecutionAggregate {
  /** Chronologically sorted executions used for the computation. */
  count: number;
  /** Weighted average entry price over ENTRY + ADD events. */
  avgEntry: Decimal | null;
  /** Weighted average exit price over PARTIAL_EXIT + FINAL_EXIT events. */
  avgExit: Decimal | null;
  /** Total lots entered (ENTRY + ADD). */
  totalEntryLots: Decimal;
  /** Total lots exited. */
  totalExitLots: Decimal;
  /** totalEntryLots − totalExitLots (0 when fully closed). */
  remainingLots: Decimal;
  /** Realized gross P&L in QUOTE currency (before costs), signed by direction. */
  grossPnlQuote: Decimal | null;
  /** Sum of signed commissions (account currency). */
  totalCommission: Decimal;
  firstEntryTime: Date | null;
  lastExitTime: Date | null;
}

const ENTRY_TYPES = new Set<string>(["ENTRY", "ADD"]);
const EXIT_TYPES = new Set<string>(["PARTIAL_EXIT", "FINAL_EXIT"]);

export function aggregateExecutions(
  direction: Direction,
  instrument: InstrumentSpec,
  executions: ExecutionLike[]
): ExecutionAggregate {
  const sorted = [...executions].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  const contract = toD(instrument.contractSize);

  // Weighted-average cost basis.
  let basisLots = D0; // open lots carried by the basis
  let basisNotional = D0; // Σ price × lots (entries)
  let entryNotional = D0; // for avgEntry over ALL entry events
  let entryLotsTotal = D0;
  let exitNotional = D0;
  let exitLotsTotal = D0;
  let realized = D0;
  let hasRealized = false;
  let totalCommission = D0;

  let firstEntryTime: Date | null = null;
  let lastExitTime: Date | null = null;

  for (const ex of sorted) {
    const lots = toD(ex.lots);
    const price = toD(ex.price);
    totalCommission = totalCommission.plus(toD(ex.commission));

    if (ENTRY_TYPES.has(ex.type)) {
      basisLots = basisLots.plus(lots);
      basisNotional = basisNotional.plus(price.times(lots));
      entryLotsTotal = entryLotsTotal.plus(lots);
      entryNotional = entryNotional.plus(price.times(lots));
      const t = new Date(ex.time);
      if (firstEntryTime === null || t < firstEntryTime) firstEntryTime = t;
    } else if (EXIT_TYPES.has(ex.type)) {
      const openLots = basisLots;
      if (openLots.gt(0)) {
        const avgCost = basisNotional.div(openLots);
        const exited = lots.gt(openLots) ? openLots : lots; // clamp over-exits
        realized = realized.plus(
          priceDiff(direction, avgCost, price).times(exited).times(contract)
        );
        hasRealized = true;
        basisLots = basisLots.minus(exited);
        basisNotional = basisNotional.minus(avgCost.times(exited));
        exitLotsTotal = exitLotsTotal.plus(exited);
        exitNotional = exitNotional.plus(price.times(exited));
      }
      const t = new Date(ex.time);
      if (lastExitTime === null || t > lastExitTime) lastExitTime = t;
    }
  }

  return {
    count: sorted.length,
    avgEntry: entryLotsTotal.gt(0) ? entryNotional.div(entryLotsTotal) : null,
    avgExit: exitLotsTotal.gt(0) ? exitNotional.div(exitLotsTotal) : null,
    totalEntryLots: entryLotsTotal,
    totalExitLots: exitLotsTotal,
    remainingLots: basisLots,
    grossPnlQuote: hasRealized ? realized : null,
    totalCommission,
    firstEntryTime,
    lastExitTime,
  };
}

/** Type guard for execution types coming from external sources (CSV import). */
export function isExecutionType(v: string): v is ExecutionType {
  return v === "ENTRY" || v === "ADD" || v === "PARTIAL_EXIT" || v === "FINAL_EXIT";
}
