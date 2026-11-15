/**
 * PROP challenge status (v1 phase 5) — powers the breach-risk widget.
 *
 * Equity basis (documented): CLOSED non-draft trades of the ONE account,
 * summed in the account currency — the same convention as the equity curve,
 * restricted to a single account so multi-currency aggregation never mixes.
 *  - currentEquity = initialBalance + Σ netPnl (closed since startDate).
 *  - peakEquity    = running high-water mark over the same series.
 *  - todayPnl      = Σ netPnl of trades closed during the current LOCAL day.
 * Cash transactions are ignored on PROP challenges (deposits/withdrawals are
 * not part of a firm evaluation).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toD } from "@/lib/trading/dec";
import { computePropStatus, localDateInTz } from "@/lib/analytics/calendar";
import type { PropStatusPayload } from "@/lib/trading/dto";
import { toAccountDTO } from "@/server/reference";

const TRADE_SELECT = {
  exitTime: true,
  netPnl: true,
} as const;

type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

export async function getPropStatus(
  userId: string,
  accountId?: string
): Promise<PropStatusPayload | null> {
  const [profile, accounts] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  // Selection: the requested account if owned, else the first PROP account,
  // else null (no PROP challenge configured).
  const account =
    (accountId != null ? accounts.find((a) => a.id === accountId) : null) ??
    accounts.find((a) => a.type === "PROP") ??
    null;
  if (!account) return null;

  const timezone = profile?.timezone ?? "UTC";

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
  let todayPnl = toD(0);
  let today: string | null = null;
  try {
    today = localDateInTz(new Date(), timezone);
  } catch {
    today = null;
  }

  for (const t of rows) {
    if (t.exitTime == null || t.netPnl == null) continue;
    const pnl = toD(t.netPnl);
    cum = cum.plus(pnl);
    const equity = initial.plus(cum);
    if (equity.gt(peak)) peak = equity;
    if (today != null && localDateInTz(t.exitTime, timezone) === today) {
      todayPnl = todayPnl.plus(pnl);
    }
  }

  const status = computePropStatus({
    initialBalance: initial,
    currentEquity: initial.plus(cum),
    peakEquity: peak,
    todayPnl,
    maxDailyLossPercent:
      account.maxDailyLossPercent != null
        ? account.maxDailyLossPercent.toString()
        : null,
    maxTotalDrawdownPercent:
      account.maxTotalDrawdownPercent != null
        ? account.maxTotalDrawdownPercent.toString()
        : null,
    profitTarget:
      account.profitTarget != null ? account.profitTarget.toString() : null,
    drawdownType:
      account.drawdownType === "TRAILING" || account.drawdownType === "STATIC"
        ? account.drawdownType
        : null,
  });

  return { account: toAccountDTO(account), status };
}
