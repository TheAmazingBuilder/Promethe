/**
 * Per-version strategy performance (Lot 11, roadmap §14).
 *
 * Trades freeze the strategy definition version at entry
 * (`Trade.strategyVersion`) but no evaluation ever read it back: every
 * performance view grouped by strategy only, so a strategy rewrite silently
 * mixed trades executed under different rules. This module groups closed
 * trades by their FROZEN version so results can be tied to the version
 * actually traded under.
 *
 * A null version means the trade predates versioning (or was never linked
 * to a strategy version); it is shown as its own bucket, never merged into
 * another version's numbers.
 */

export interface VersionPerformanceInput {
  /** Frozen definition version at entry; null = never frozen. */
  strategyVersion: number | null;
  rMultiple: number | null;
  resultType: string | null;
}

export interface VersionPerformanceRow {
  /** Frozen definition version, null for the pre-versioning bucket. */
  version: number | null;
  trades: number;
  totalR: number | null;
  expectancyR: number | null;
  winRatePct: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function versionPerformance(
  trades: VersionPerformanceInput[],
): VersionPerformanceRow[] {
  const byVersion = new Map<number | null, VersionPerformanceInput[]>();
  for (const t of trades) {
    const list = byVersion.get(t.strategyVersion) ?? [];
    list.push(t);
    byVersion.set(t.strategyVersion, list);
  }
  const rows: VersionPerformanceRow[] = [];
  for (const [version, list] of byVersion) {
    const rs = list
      .map((t) => t.rMultiple)
      .filter((r): r is number => r !== null && Number.isFinite(r));
    const wins = list.filter((t) => t.resultType === "WIN").length;
    rows.push({
      version,
      trades: list.length,
      totalR: rs.length === 0 ? null : round2(rs.reduce((a, b) => a + b, 0)),
      expectancyR:
        rs.length === 0 ? null : round2(rs.reduce((a, b) => a + b, 0) / rs.length),
      winRatePct:
        list.length === 0 ? null : round2((wins / list.length) * 100),
    });
  }
  // Newest version first; the pre-versioning (null) bucket last.
  rows.sort((a, b) => {
    if (a.version === null) return 1;
    if (b.version === null) return -1;
    return b.version - a.version;
  });
  return rows;
}
