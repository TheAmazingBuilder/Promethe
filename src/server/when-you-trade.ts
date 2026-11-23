/**
 * When you trade (MRT wave 2) — server aggregation.
 *
 * Same closed-trade scope as getAnalytics (period + account filter,
 * user's timezone): rows are mapped through toAnalyticsTrade so the
 * local entry hour / weekday match the Analytics page exactly, then
 * aggregated by the pure computeWhenYouTrade. No schema change, no
 * persistence — a read-only aggregation.
 */
import { db } from "@/lib/db";
import { computeWhenYouTrade } from "@/lib/analytics/when-you-trade";
import { periodCutoff, toAnalyticsTrade } from "@/server/analytics";
import { getDisplayPreferences } from "@/server/display-preferences";
import type { AnalyticsQuery } from "@/lib/validations/analytics";
import type { WhenYouTradePayload } from "@/lib/trading/dto";
import type { Prisma } from "@prisma/client";
import { scopeTradesToCurrency } from "@/lib/analytics/currency-scope";
import { resolveOwnedAccount } from "@/server/account-errors";

export async function getWhenYouTrade(
  userId: string,
  query: AnalyticsQuery
): Promise<WhenYouTradePayload> {
  const [profile, accounts, prefs] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    getDisplayPreferences(userId),
  ]);

  // Invalid or foreign account IDs are rejected; never widen to all accounts.
  const accountFilter = resolveOwnedAccount(accounts, query.account);

  const where: Prisma.TradeWhereInput = {
    userId,
    status: "CLOSED",
    isDraft: false,
    ...(accountFilter ? { accountId: accountFilter.id } : {}),
  };
  const cutoff = periodCutoff(query.period);
  if (cutoff != null) where.exitTime = { gte: cutoff };

  const rows = await db.trade.findMany({
    where,
    include: { instrument: true, account: true, strategy: true },
  });

  const timezone = profile?.timezone ?? "UTC";
  const currency =
    accountFilter?.currency ?? profile?.baseCurrency ?? "USD";
  const currencyScope = scopeTradesToCurrency(rows, currency);
  const trades = currencyScope.trades.map((t) =>
    toAnalyticsTrade(t, timezone, prefs.tradingDay)
  );

  return {
    period: query.period,
    accountId: accountFilter?.id ?? null,
    currency,
    timezone,
    ...computeWhenYouTrade(trades),
  };
}
