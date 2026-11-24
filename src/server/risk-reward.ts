/**
 * Risk / Reward summary (Phase 2) — real stats + daily risk budget.
 *
 * - Real stats come from the user's own closed trades only: win rate,
 *   average realized/planned R:R, expectancy in $ and in R. When a value
 *   has no data behind it the DTO carries null — never an invented number.
 * - Daily risk budget: the user sets a % of the balance (default: unset).
 *   Consumed today = Σ risk of OPEN trades (risk still live) + realized
 *   losses of the trading day. This is NOT the prop daily-loss limit:
 *   that one counts realized losses only, while the budget also counts
 *   the risk sitting in open positions. The UI says so.
 * - Budget storage: Profile.preferencesJson under
 *   `dailyRiskBudgetPercent` — no new table, no schema change. (The
 *   shared parsePreferences() whitelists its keys, so this module parses
 *   the JSON itself, defensively.)
 * - Balance convention: Σ active accounts (initialBalance + realized
 *   P&L of closed trades + signed cash transactions), the same base the
 *   equity curve uses.
 */
import { db } from "@/lib/db";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay } from "@/lib/time/trading-day";
import { D0, D100, toD } from "@/lib/trading/dec";
import type { RiskRewardSummaryDTO } from "@/lib/trading/dto";
import { computeRiskRewardStats } from "@/lib/tools/risk-reward";

const BUDGET_KEY = "dailyRiskBudgetPercent";

function parseBudgetPercent(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const raw = parsed[BUDGET_KEY];
    if (typeof raw !== "string") return null;
    const v = toD(raw);
    if (!v.isFinite() || v.lte(0) || v.gt(100)) return null;
    return v.toString();
  } catch {
    return null;
  }
}

export async function getDailyRiskBudgetPercent(
  userId: string
): Promise<string | null> {
  const profile = await db.profile.findUnique({
    where: { id: userId },
    select: { preferencesJson: true },
  });
  return parseBudgetPercent(profile?.preferencesJson);
}

/** Set (decimal string, 0 < p ≤ 100) or clear (null) the daily budget %. */
export async function setDailyRiskBudgetPercent(
  userId: string,
  percent: string | null
): Promise<string | null> {
  const profile = await db.profile.findUniqueOrThrow({
    where: { id: userId },
    select: { preferencesJson: true },
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(profile.preferencesJson ?? "{}") as Record<
      string,
      unknown
    >;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      parsed = {};
    }
  } catch {
    parsed = {};
  }
  if (percent === null) {
    delete parsed[BUDGET_KEY];
  } else {
    parsed[BUDGET_KEY] = percent;
  }
  await db.profile.update({
    where: { id: userId },
    data: { preferencesJson: JSON.stringify(parsed) },
  });
  return percent;
}

export async function getRiskRewardSummary(
  userId: string
): Promise<RiskRewardSummaryDTO> {
  const [profile, prefs, accounts, closed, open, cash] = await Promise.all([
    db.profile.findUnique({
      where: { id: userId },
      select: { timezone: true, baseCurrency: true, preferencesJson: true },
    }),
    getDisplayPreferences(userId),
    db.account.findMany({
      where: { userId, isActive: true },
      select: { id: true, initialBalance: true, currency: true },
    }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: "CLOSED" },
      select: {
        accountId: true,
        netPnl: true,
        pnlCurrency: true,
        rMultiple: true,
        realizedRR: true,
        plannedRR: true,
        resultType: true,
        exitTime: true,
      },
    }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: "OPEN" },
      select: { accountId: true, pnlCurrency: true, riskAmount: true },
    }),
    db.cashTransaction.findMany({
      where: { userId },
      select: { accountId: true, amount: true },
    }),
  ]);

  const timezone = profile?.timezone ?? "UTC";
  const currency = profile?.baseCurrency ?? "USD";
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);
  const today = dayOf(new Date());

  // Keep all money aggregates in the profile base currency, following
  // Analytics' stored pnlCurrency convention. Never add USD and EUR values.
  const currencyAccounts = accounts.filter((account) => account.currency === currency);
  const accountIds = new Set(currencyAccounts.map((account) => account.id));
  let balance = D0;
  for (const account of currencyAccounts) {
    balance = balance.plus(toD(account.initialBalance));
  }
  for (const trade of closed) {
    if (accountIds.has(trade.accountId) && trade.pnlCurrency === currency) {
      balance = balance.plus(toD(trade.netPnl));
    }
  }
  for (const transaction of cash) {
    if (accountIds.has(transaction.accountId)) {
      balance = balance.plus(toD(transaction.amount));
    }
  }

  const stats = computeRiskRewardStats(closed, currency, today, dayOf);
  const scopedOpen = open.filter((trade) => trade.pnlCurrency === currency);
  let openRisk = D0;
  for (const trade of scopedOpen) {
    openRisk = openRisk.plus(toD(trade.riskAmount));
  }

  // The daily budget is profile-wide but still currency-scoped. Trades in
  // other P&L currencies are reported as excluded rather than mixed in.
  const consumed = openRisk.plus(toD(stats.realizedLossToday));
  const budgetPercent = parseBudgetPercent(profile?.preferencesJson);
  const budgetAmount =
    budgetPercent === null
      ? null
      : balance.times(toD(budgetPercent)).div(D100);

  return {
    currency,
    tradingDay: today,
    balance: balance.toString(),
    excludedTradeCount: stats.excludedTradeCount,
    excludedOpenTradeCount: open.length - scopedOpen.length,
    budget: {
      percent: budgetPercent,
      amount: budgetAmount?.toString() ?? null,
      isSet: budgetPercent !== null,
    },
    today: {
      openTrades: scopedOpen.length,
      openRisk: openRisk.toString(),
      realizedLossToday: stats.realizedLossToday,
      realizedPnlToday: stats.realizedPnlToday,
      consumed: consumed.toString(),
      remaining:
        budgetAmount === null
          ? null
          : budgetAmount.minus(consumed).toString(),
      usedPercent:
        budgetAmount === null || budgetAmount.lte(0)
          ? null
          : consumed.div(budgetAmount).toNumber(),
    },
    realStats: stats.realStats,
  };
}
