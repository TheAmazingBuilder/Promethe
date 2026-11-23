/**
 * Keep monetary aggregates inside one account currency.
 * Raw P&L values from different currencies are not additive; until historical
 * FX conversion is available, only trades matching the displayed currency
 * may contribute to money-based statistics.
 */
export function scopeTradesToCurrency<T extends { accountId: string }>(
  trades: T[],
  accounts: Array<{ id: string; currency: string }>,
  currency: string
): { trades: T[]; excludedTradeCount: number } {
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency]));
  const included = trades.filter((trade) => currencyByAccount.get(trade.accountId) === currency);
  return {
    trades: included,
    excludedTradeCount: trades.length - included.length,
  };
}
