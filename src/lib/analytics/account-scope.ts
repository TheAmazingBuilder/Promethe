/**
 * Select the accounts that contribute to the equity starting balance.
 * A single-account view must never include the balances of sibling accounts;
 * the global view keeps the existing same-currency aggregation convention.
 */
export function selectEquityAccounts<T extends { id: string; currency: string }>(
  accounts: T[],
  accountFilter: T | null,
  currency: string
): T[] {
  return accountFilter != null
    ? [accountFilter]
    : accounts.filter((account) => account.currency === currency);
}
