/**
 * Account health badges (MRT wave 2, chantier 4) — server loader.
 *
 * One health record per account, from the REAL equity curve: initial
 * balance plus the signed net P&L of closed non-draft trades, in
 * chronological exit order, with the running peak as the high-water mark
 * (the same convention as the PROP status in src/server/prop-status.ts,
 * including the startDate window when the account sets one). The pure
 * badge decision lives in src/lib/accounts/health.ts; this module only
 * loads the numbers. No schema change, no new table.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import { assessAccountHealth } from "@/lib/accounts/health";
import type { AccountHealthDTO } from "@/lib/trading/dto";

const TRADE_SELECT = {
  exitTime: true,
  netPnl: true,
} as const;

type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

/** Window for "recent" momentum in the Growing rule, in days. */
const RECENT_WINDOW_DAYS = 30;

export async function getAccountsHealth(
  userId: string
): Promise<AccountHealthDTO[]> {
  const accounts = await db.account.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) return [];

  const recentCutoff = new Date(
    Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  return Promise.all(
    accounts.map(async (account) => {
      const where: Prisma.TradeWhereInput = {
        userId,
        accountId: account.id,
        status: "CLOSED",
        isDraft: false,
        exitTime: { not: null },
      };
      if (account.startDate != null) {
        where.exitTime = { gte: account.startDate, not: null };
      }
      const rows = (await db.trade.findMany({
        where,
        select: TRADE_SELECT,
        orderBy: { exitTime: "asc" },
      })) as TradeRow[];

      const initial = toD(account.initialBalance);
      let cum = toD(0);
      let peak = initial;
      let recentNet = toD(0);
      let lastTradeAt: string | null = null;
      let tradeCount = 0;

      for (const t of rows) {
        if (t.exitTime == null || t.netPnl == null) continue;
        const pnl = toD(t.netPnl);
        cum = cum.plus(pnl);
        const equity = initial.plus(cum);
        if (equity.gt(peak)) peak = equity;
        if (t.exitTime >= recentCutoff) recentNet = recentNet.plus(pnl);
        lastTradeAt = t.exitTime.toISOString();
        tradeCount += 1;
      }

      const currentEquity = initial.plus(cum);
      const health = assessAccountHealth({
        initialBalance: initial.toString(),
        currentEquity: currentEquity.toString(),
        peakEquity: peak.toString(),
        tradeCount,
        recentNetPnl: recentNet.toString(),
        maxTotalDrawdownPercent:
          account.maxTotalDrawdownPercent != null
            ? account.maxTotalDrawdownPercent.toString()
            : null,
      });

      return {
        accountId: account.id,
        currency: account.currency,
        status: health.status,
        drawdown: health.drawdown,
        drawdownPercent: health.drawdownPercent,
        drawdownUsagePercent: health.drawdownUsagePercent,
        netPnl: health.netPnl,
        tradeCount,
        lastTradeAt,
      } satisfies AccountHealthDTO;
    })
  );
}
