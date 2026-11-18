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
import type {
  RiskRewardRealStats,
  RiskRewardSummaryDTO,
} from "@/lib/trading/dto";

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
      select: { id: true, initialBalance: true },
    }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: "CLOSED" },
      select: {
        accountId: true,
        netPnl: true,
        rMultiple: true,
        realizedRR: true,
        plannedRR: true,
        resultType: true,
        exitTime: true,
      },
    }),
    db.trade.findMany({
      where: { userId, isDraft: false, status: "OPEN" },
      select: { riskAmount: true },
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

  // ── Balance ────────────────────────────────────────────────────────────────
  const accountIds = new Set(accounts.map((a) => a.id));
  let balance = D0;
  for (const a of accounts) balance = balance.plus(toD(a.initialBalance));
  for (const t of closed) {
    if (accountIds.has(t.accountId)) balance = balance.plus(toD(t.netPnl));
  }
  for (const c of cash) {
    if (accountIds.has(c.accountId)) balance = balance.plus(toD(c.amount));
  }

  // ── Real stats (closed trades only) ────────────────────────────────────────
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let sumWin = D0;
  let sumLoss = D0; // magnitudes, positive
  let sumR = D0;
  let countR = 0;
  let sumRealizedRR = D0;
  let countRealizedRR = 0;
  let sumPlannedRR = D0;
  let countPlannedRR = 0;
  let sumPnl = D0;
  let realizedLossToday = D0;
  let realizedPnlToday = D0;

  for (const t of closed) {
    const pnl = toD(t.netPnl);
    sumPnl = sumPnl.plus(pnl);
    const isWin =
      t.resultType === "WIN" || (t.resultType == null && pnl.gt(0));
    const isLoss =
      t.resultType === "LOSS" || (t.resultType == null && pnl.lt(0));
    if (isWin) {
      wins++;
      sumWin = sumWin.plus(pnl);
    } else if (isLoss) {
      losses++;
      sumLoss = sumLoss.plus(pnl.abs());
    } else {
      breakevens++;
    }
    if (t.rMultiple != null) {
      sumR = sumR.plus(toD(t.rMultiple));
      countR++;
    }
    if (t.realizedRR != null) {
      sumRealizedRR = sumRealizedRR.plus(toD(t.realizedRR));
      countRealizedRR++;
    }
    if (t.plannedRR != null) {
      sumPlannedRR = sumPlannedRR.plus(toD(t.plannedRR));
      countPlannedRR++;
    }
    if (t.exitTime != null && dayOf(t.exitTime) === today) {
      realizedPnlToday = realizedPnlToday.plus(pnl);
      if (pnl.lt(0)) realizedLossToday = realizedLossToday.plus(pnl.abs());
    }
  }

  const n = closed.length;
  const realStats: RiskRewardRealStats = {
    closedTrades: n,
    wins,
    losses,
    breakevens,
    winRate: n === 0 ? null : (wins / n).toString(),
    avgRealizedRR:
      countRealizedRR === 0
        ? null
        : sumRealizedRR.div(countRealizedRR).toString(),
    avgPlannedRR:
      countPlannedRR === 0
        ? null
        : sumPlannedRR.div(countPlannedRR).toString(),
    expectancyMoney: n === 0 ? null : sumPnl.div(n).toString(),
    expectancyR: countR === 0 ? null : sumR.div(countR).toString(),
    avgWin: wins === 0 ? null : sumWin.div(wins).toString(),
    avgLoss: losses === 0 ? null : sumLoss.div(losses).toString(),
  };

  // ── Daily risk budget ──────────────────────────────────────────────────────
  const budgetPercent = parseBudgetPercent(profile?.preferencesJson);
  const budgetAmount =
    budgetPercent === null
      ? null
      : balance.times(toD(budgetPercent)).div(D100);
  let openRisk = D0;
  for (const t of open) openRisk = openRisk.plus(toD(t.riskAmount));
  const consumed = openRisk.plus(realizedLossToday);

  return {
    currency,
    tradingDay: today,
    balance: balance.toString(),
    budget: {
      percent: budgetPercent,
      amount: budgetAmount?.toString() ?? null,
      isSet: budgetPercent !== null,
    },
    today: {
      openTrades: open.length,
      openRisk: openRisk.toString(),
      realizedLossToday: realizedLossToday.toString(),
      realizedPnlToday: realizedPnlToday.toString(),
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
    realStats,
  };
}
