/** Shared account-scope validation for analytics and dashboard queries. */
export class AccountNotFoundError extends Error {
  readonly code = "ACCOUNT_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("Account not found.");
    this.name = "AccountNotFoundError";
  }
}

/**
 * Resolve an optional account ID strictly within the authenticated user's
 * already-loaded account list. Invalid IDs must never widen a query to all.
 */
export function resolveOwnedAccount<T extends { id: string }>(
  accounts: readonly T[],
  accountId: string | null | undefined
): T | null {
  if (accountId == null) return null;
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (account == null) throw new AccountNotFoundError();
  return account;
}
