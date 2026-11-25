/**
 * Prop-firm finance audit (§13) - pure helpers.
 *
 * A money movement (payout or expense) must never disappear without a
 * trace: every create / update / delete / restore writes a
 * PropFinanceAudit row holding a JSON snapshot of the movement before and
 * after the change. These helpers are pure so the rules are unit-testable
 * without a database.
 */

/** A payout as stored at audit time (amounts are decimal strings). */
export type PropFinancePayoutSnapshot = {
  kind: "PAYOUT";
  grossAmount: string;
  profitSplitPercent: string;
  netAmount: string;
  currency: string;
  status: string;
  /** Day the payout was requested (YYYY-MM-DD). */
  requestedAt: string;
  /** Day the payout was received (YYYY-MM-DD), null while pending. */
  receivedAt: string | null;
  method: string | null;
  note: string | null;
};

/** An expense as stored at audit time (amounts are decimal strings). */
export type PropFinanceExpenseSnapshot = {
  kind: "EXPENSE";
  type: string;
  amount: string;
  currency: string;
  /** Day of the expense (YYYY-MM-DD). */
  date: string;
  note: string | null;
  challengeId: string | null;
};

export type PropFinanceMovementSnapshot =
  | PropFinancePayoutSnapshot
  | PropFinanceExpenseSnapshot;

export type PropFinanceAuditKind = "PAYOUT" | "EXPENSE";
export type PropFinanceAuditAction = "CREATED" | "UPDATED" | "DELETED" | "RESTORED";

type DecimalLike = { toString(): string };

type PayoutRowLike = {
  grossAmount: DecimalLike;
  profitSplitPercent: DecimalLike;
  netAmount: DecimalLike;
  currency: string;
  status: string;
  requestedAt: Date;
  receivedAt: Date | null;
  method: string | null;
  note: string | null;
};

type ExpenseRowLike = {
  type: string;
  amount: DecimalLike;
  currency: string;
  date: Date;
  note: string | null;
  challengeId: string | null;
};

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Serialize a payout row into its audit snapshot shape. */
export function payoutSnapshot(row: PayoutRowLike): PropFinancePayoutSnapshot {
  return {
    kind: "PAYOUT",
    grossAmount: row.grossAmount.toString(),
    profitSplitPercent: row.profitSplitPercent.toString(),
    netAmount: row.netAmount.toString(),
    currency: row.currency,
    status: row.status,
    requestedAt: day(row.requestedAt),
    receivedAt: row.receivedAt == null ? null : day(row.receivedAt),
    method: row.method,
    note: row.note,
  };
}

/** Serialize an expense row into its audit snapshot shape. */
export function expenseSnapshot(row: ExpenseRowLike): PropFinanceExpenseSnapshot {
  return {
    kind: "EXPENSE",
    type: row.type,
    amount: row.amount.toString(),
    currency: row.currency,
    date: day(row.date),
    note: row.note,
    challengeId: row.challengeId,
  };
}

export type PayoutDateRuleError =
  | "PAYOUT_BEFORE_CHALLENGE_START"
  | "RECEIVED_BEFORE_REQUESTED";

/**
 * Date rules for a payout, against the challenge it belongs to.
 *
 * - A payout cannot be requested before the challenge starts: no payout
 *   can exist before any trading happened.
 * - A payout cannot be received before it was requested.
 *
 * Dates are YYYY-MM-DD day strings, so plain string comparison orders
 * them. Returns the error code of the first broken rule, or null when
 * the dates are consistent. Expenses have no range rule: a fee (data,
 * reset) can legitimately predate the challenge start, and a payout
 * after the challenge ends is normal, so no end-date rule applies.
 */
export function validatePayoutDates(input: {
  /** Challenge start day (YYYY-MM-DD). */
  startDate: string;
  /** Requested day (YYYY-MM-DD). */
  requestedAt: string;
  /** Received day (YYYY-MM-DD), null while pending. */
  receivedAt: string | null;
}): PayoutDateRuleError | null {
  if (input.requestedAt < input.startDate) return "PAYOUT_BEFORE_CHALLENGE_START";
  if (input.receivedAt != null && input.receivedAt < input.requestedAt) {
    return "RECEIVED_BEFORE_REQUESTED";
  }
  return null;
}
