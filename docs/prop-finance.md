# Prop Firm finance - payouts and expenses (§13)

This document describes the financial rules for prop-firm payouts and
expenses, as implemented for §13 of the roadmap. The challenge engine
itself (rules, evaluation, phases) lives in `src/lib/prop/engine.ts`
and is not covered here.

## What counts as a financial movement

Two models, both owned by one user and attached to one challenge:

- `PropPayout` - a payout request from the firm. Fields: gross amount,
  profit split percent (default 80), net amount (computed from gross
  and split), currency (default USD), requested date, received date
  (optional), status `REQUESTED | RECEIVED | REJECTED`, optional note.
- `PropExpense` - a cost paid to the firm: challenge fee, reset,
  add-on or other. Fields: type, amount, currency, date, optional note.

Both models carry `createdAt`, `updatedAt` and `deletedAt` (§13).

## Ownership

Every server function (`src/server/prop-firms.ts`) scopes by `userId`
and challenge id. A user can never create, read, update, delete or
restore a payout or expense of another user or of a challenge they do
not own: the functions return 404 (or false for delete/restore) when
the challenge is not theirs.

## Totals - what counts

The challenge evaluation (`src/server/prop-evaluation.ts`) shows three
fee totals:

- `totalExpenses` - sum of all live expenses, in the fee currency.
- `totalPayoutsGross` / `totalPayoutsNet` - sum of payouts with status
  **RECEIVED only**, in the fee currency.

A REQUESTED payout is money not yet in hand and a REJECTED payout
never arrives, so neither is counted. This was a §13 correction:
before, every payout was summed regardless of status, so a rejected
payout inflated the payout totals.

## Currency

Movements may be recorded in any ISO currency (a payout in EUR on a
USD challenge is allowed). Totals sum only the rows in the fee
currency. When at least one live payout or expense uses another
currency, the evaluation returns `mixedCurrencies: true` and the
challenge view shows a warning under the fees line. No live currency
conversion is done: the app has no exchange-rate provider for this
path and a silent conversion would be worse than an explicit warning.

## Dates

- A payout `requestedAt` must be on or after the challenge start date.
  A payout dated before the challenge starts is refused with 422
  `PAYOUT_BEFORE_CHALLENGE_START`.
- A payout `receivedAt`, when set, must be on or after `requestedAt`.
  Refused with 422 `RECEIVED_BEFORE_REQUESTED`.
- Expenses have no date range rule: a fee can legitimately be paid
  before the challenge starts, and payouts after the challenge ends
  are normal.

## Deletion is logical, never destructive

A payout or expense is never hard-deleted. Deleting sets `deletedAt`
and writes an audit entry:

- The row disappears from the challenge lists, from the evaluation
  totals and from the account export.
- The row stays in the database and can be restored from the finance
  history in the challenge view (Restore button, or the restore API
  routes). Restoring clears `deletedAt` and writes a RESTORED entry.
- Deleting a challenge still cascades to its payouts, expenses and
  audit rows: deleting the whole challenge is an explicit, separate
  decision, not a silent movement deletion.

Why logical delete instead of refusing the deletion: the evaluation
totals are computed live from the movements, so a deleted movement is
simply no longer part of any total. There is no frozen report that a
deleted movement could falsify. The audit trail is what makes the
deletion safe: nothing disappears without a trace.

## Audit trail

Every create, update, delete and restore writes a row in
`prop_finance_audits` (`PropFinanceAudit` model), in the same database
transaction as the change:

- `kind`: PAYOUT or EXPENSE.
- `movementId`: the id of the payout or expense.
- `action`: CREATED, UPDATED, DELETED or RESTORED.
- `before` / `after`: JSON snapshots of the movement (amounts as
  strings, dates as YYYY-MM-DD). `before` is null on create, `after`
  is null on delete.
- `createdAt`: when the change happened.

The trail is permanent: it is not pruned by the 30-day ChangeLog
retention and it is not part of the trash. It is consultable from the
challenge view (finance history section, latest entries first) and
from `GET /api/prop-firms/challenges/[id]/finance-audit`.

The account export (`propfirms.json`) includes the audit rows and a
`propFinanceAudits` manifest count. The export never includes
soft-deleted movements themselves.

## API routes

- `POST /api/prop-firms/challenges/[id]/payouts` - create a payout.
- `PATCH /api/prop-firms/challenges/[id]/payouts/[payoutId]` - update.
- `DELETE /api/prop-firms/challenges/[id]/payouts/[payoutId]` -
  logical delete.
- `POST /api/prop-firms/challenges/[id]/payouts/[payoutId]/restore` -
  restore a deleted payout.
- Same four routes for `expenses/[expenseId]`.
- `GET /api/prop-firms/challenges/[id]/finance-audit` - audit trail.

Each route has a `/api/v1/` alias. All routes are rate-limited and
return 404 when the challenge is not owned, 422 on validation errors.

## What is deliberately not built

- No automatic payouts, no bank integration.
- No live currency conversion.
- No evaluation-history table: the audit trail records financial
  changes, not evaluation results.
