/**
 * Keep monetary aggregates inside one trade currency.
 * A trade's stored pnlCurrency is authoritative: the account currency may
 * change later, but historical P&L must retain its original denomination.
 */
export function scopeTradesToCurrency<T extends { pnlCurrency: string }>(
  trades: T[],
  currency: string
): { trades: T[]; excludedTradeCount: number } {
  const included = trades.filter((trade) => trade.pnlCurrency === currency);
  return {
    trades: included,
    excludedTradeCount: trades.length - included.length,
  };
}
