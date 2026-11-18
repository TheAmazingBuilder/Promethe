/**
 * Trade grades (MRT wave 3, chantier 1) — the setup grade of a trade.
 *
 * MRT grades a setup A+ / A / B / C in its "Log New Trade" form and breaks
 * analytics down by that grade. Promethe had no trade grade before this:
 * TradeReview holds 1-5 scores (confidence, setup quality, execution) and
 * Strategy.grade is a presentation grade on the strategy definition — neither
 * is a grade on the trade itself, so neither is reused here.
 *
 * Values: exactly the four MRT grades. No D: MRT has none, and inventing a
 * lower rung would change the meaning of the scale. "Ungraded" is not a
 * stored value — it is the honest display of a null grade, so trades
 * created before grades existed stay valid and are never given a grade
 * they were not given.
 *
 * Client-safe (no Prisma, no i18n): the grade letters are the same in
 * every language; only the "Ungraded" label is translated, at the call site.
 */

/** MRT setup grades, best first. */
export const TRADE_GRADES = ["A+", "A", "B", "C"] as const;

export type TradeGrade = (typeof TRADE_GRADES)[number];

/** Rank for ordering (A+ first); unknown values sort last. */
export const TRADE_GRADE_ORDER: Record<string, number> = {
  "A+": 0,
  A: 1,
  B: 2,
  C: 3,
};

export function isTradeGrade(value: unknown): value is TradeGrade {
  return (
    typeof value === "string" &&
    (TRADE_GRADES as readonly string[]).includes(value)
  );
}

/** Best grade first; ungraded (null) last. */
export function compareTradeGrades(
  a: string | null,
  b: string | null
): number {
  const ra = a == null ? TRADE_GRADES.length : (TRADE_GRADE_ORDER[a] ?? TRADE_GRADES.length);
  const rb = b == null ? TRADE_GRADES.length : (TRADE_GRADE_ORDER[b] ?? TRADE_GRADES.length);
  return ra - rb;
}

/** Badge tone per grade (emerald theme; C reuses the loss tone). */
export const TRADE_GRADE_BADGE_CLASS: Record<TradeGrade, string> = {
  "A+": "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  A: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  B: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  C: "border-loss-subtle bg-loss-subtle text-loss",
};
