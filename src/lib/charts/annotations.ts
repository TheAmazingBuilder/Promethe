/**
 * TradeJournal — chart annotations engine (v2.5 Module 2, spec §4.7).
 *
 * PURE and client-safe: annotation scoping (an annotation applies only to
 * charts matching its scope — GLOBAL, ACCOUNT, STRATEGY) and before/after
 * statistics around an annotation date (or range) with sample sizes and a
 * not-significant warning.
 */
import { computeTradeStats, type BuilderTrade } from "@/lib/charts/builder";

// ── Types (mirror ChartAnnotation rows) ──────────────────────────────────────

export interface Annotation {
  id: string;
  /** ISO timestamp (UTC) — point, or range start when endDate is set. */
  date: string;
  /** ISO timestamp (exclusive end) — null = point annotation. */
  endDate: string | null;
  label: string;
  note: string | null;
  kind: string; // STRATEGY_CHANGE | VACATION | BAD_PERIOD | NEWS | RULE_CHANGE | OTHER
  color: string | null;
  scope: string; // GLOBAL | ACCOUNT | STRATEGY
  accountId: string | null;
  strategyId: string | null;
}

export interface ChartScopeContext {
  /** Chart account filter (null = all accounts). */
  accountId: string | null;
  /** Chart strategy filter (null = all strategies). */
  strategyId: string | null;
}

/** True when the annotation applies to a chart with the given scope context. */
export function annotationApplies(
  a: Annotation,
  ctx: ChartScopeContext
): boolean {
  switch (a.scope) {
    case "ACCOUNT":
      return ctx.accountId == null || ctx.accountId === a.accountId;
    case "STRATEGY":
      return ctx.strategyId == null || ctx.strategyId === a.strategyId;
    default:
      return true;
  }
}

// ── Before / after statistics ────────────────────────────────────────────────

export interface SideStats {
  n: number;
  winRate: number | null; // %
  expectancyR: number | null;
  netPnl: number;
  /** Max drawdown of the cumulative P&L sequence (absolute). */
  maxDrawdown: number;
}

export interface BeforeAfter {
  before: SideStats;
  after: SideStats;
  /** True when either side has fewer than 30 trades — "not significant". */
  notSignificant: boolean;
}

const emptySide = (): SideStats => ({
  n: 0,
  winRate: null,
  expectancyR: null,
  netPnl: 0,
  maxDrawdown: 0,
});

/**
 * Stats before/after an annotation. Trades are split on their LOCAL exit
 * date (`localDate` — the P&L attribution convention of the analytics
 * engine). `before` = strictly before the annotation start; for a POINT
 * annotation `after` = from the date on; for a RANGE annotation the range
 * itself is excluded from both sides (`after` = strictly after the end).
 */
export function beforeAfterStats(
  trades: BuilderTrade[],
  annotation: Pick<Annotation, "date" | "endDate">
): BeforeAfter {
  const startDay = annotation.date.slice(0, 10);
  const endDay = (annotation.endDate ?? annotation.date).slice(0, 10);

  const before: BuilderTrade[] = [];
  const after: BuilderTrade[] = [];
  for (const t of trades) {
    const d = t.localDate ?? t.exitTime.slice(0, 10);
    if (d < startDay) {
      before.push(t);
    } else if (annotation.endDate == null) {
      if (d >= startDay) after.push(t);
    } else if (d > endDay) {
      after.push(t);
    }
  }

  return {
    before: sideStats(before),
    after: sideStats(after),
    notSignificant: before.length < 30 || after.length < 30,
  };
}

function sideStats(trades: BuilderTrade[]): SideStats {
  if (trades.length === 0) return emptySide();
  const stats = computeTradeStats(
    [...trades].sort(
      (a, b) =>
        new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime() ||
        a.id.localeCompare(b.id)
    )
  );
  return {
    n: trades.length,
    winRate: stats.winRate != null ? Number(stats.winRate) : null,
    expectancyR: stats.expectancyR != null ? Number(stats.expectancyR) : null,
    netPnl: Number(stats.netPnl),
    maxDrawdown: Number(stats.maxDrawdown),
  };
}
