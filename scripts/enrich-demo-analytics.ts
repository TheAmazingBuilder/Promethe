/**
 * scripts/enrich-demo-analytics.ts — dev-only demo enrichment (v2 Phase 4).
 *
 * Adds realistic CLOSED trades to the demo account so the analytics view
 * shows every dimension: strategies, sessions, setups, emotions, plan
 * discipline, exit reasons, fees, weekday/hour spreads, a revenge sequence
 * and an overtrading day. Prices/lots stay coherent (risk ≈ 1% of 10k).
 *
 * Idempotent: skips when the demo account already holds "demoan-" trades.
 * Usage: bun scripts/enrich-demo-analytics.ts
 */
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
process.env.TOKEN_PEPPER ??= readEnvFile("TOKEN_PEPPER");

function readEnvFile(name: string): string {
  try {
    const content = readFileSync(".env", "utf8");
    const match = content.match(new RegExp(`^${name}="?(.+?)"?$`, "m"));
    if (match) return match[1];
  } catch {
    /* ignore */
  }
  return "";
}

/** [date, utcHour, sym, dir, session, strat, setup, emotion, plan, exit, R, commission, swap] */
type Row = [string, number, string, "LONG" | "SHORT", string, string, string, string, boolean, string, number, number, number];

// The story: "Breakout Londres" (disciplined, calm → winners, plan followed),
// "Retracement NY" (mixed), FOMO/ANXIOUS deviations → losers, one Friday
// revenge sequence (-2.5R then 3 quick re-entries), one busy overtrading day,
// and a few clean light days.
const ROWS: Row[] = [
  // Week 1 — clean disciplined week (light days, winners).
  ["2026-09-21", 8, "XAUUSD", "LONG", "ASIAN", "Retracement NY", "Retracement EMA", "CALM", true, "TP_HIT", 2.0, 7, 0],
  ["2026-09-22", 8, "EURUSD", "SHORT", "ASIAN", "Retracement NY", "Retracement EMA", "CALM", true, "TP_HIT", 1.8, 3, 0],
  ["2026-09-24", 8, "XAUUSD", "SHORT", "ASIAN", "Retracement NY", "Biais HTF", "FOCUSED", true, "MANUAL", 1.2, 7, 0],
  // Week 2 — London breakouts shine.
  ["2026-09-29", 8, "XAUUSD", "LONG", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "TP_HIT", 2.2, 7, 0],
  ["2026-09-30", 9, "XAUUSD", "LONG", "LONDON", "Breakout Londres", "Breakout range", "CONFIDENT", true, "TP_HIT", 1.9, 7, 0],
  ["2026-10-01", 9, "EURUSD", "LONG", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "TRAILING", 2.5, 3, 0],
  ["2026-10-02", 8, "XAUUSD", "SHORT", "LONDON", "Breakout Londres", "Breakout range", "FOCUSED", true, "SL_HIT", -1, 7, 0],
  // Week 3 — discipline slips: FOMO deviations.
  ["2026-10-06", 20, "XAUUSD", "LONG", "NEW_YORK", "Retracement NY", "Biais HTF", "FOMO", false, "MANUAL", -1, 7, 0],
  ["2026-10-07", 20, "EURUSD", "SHORT", "NEW_YORK", "Retracement NY", "Retracement EMA", "ANXIOUS", false, "SL_HIT", -1, 3, 0],
  ["2026-10-08", 21, "XAUUSD", "SHORT", "NEW_YORK", "Retracement NY", "Biais HTF", "FOMO", false, "MANUAL", -0.8, 7, 2],
  // Week 4 — Friday revenge sequence: -2.5R then 3 rushed re-entries.
  ["2026-10-16", 12, "XAUUSD", "LONG", "OVERLAP", "Breakout Londres", "Breakout range", "CONFIDENT", true, "SL_HIT", -2.5, 7, 0],
  ["2026-10-16", 17, "XAUUSD", "LONG", "NEW_YORK", "Breakout Londres", "Breakout range", "REVENGE", false, "MANUAL", -0.6, 7, 0],
  ["2026-10-16", 19, "EURUSD", "SHORT", "NEW_YORK", "Retracement NY", "Retracement EMA", "FRUSTRATED", false, "MANUAL", -0.7, 3, 0],
  ["2026-10-16", 20, "XAUUSD", "SHORT", "NEW_YORK", "Retracement NY", "Biais HTF", "FRUSTRATED", false, "SL_HIT", -1, 7, 0],
  // Week 5 — back to discipline; breakeven management.
  ["2026-10-20", 8, "XAUUSD", "LONG", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "BREAKEVEN_STOP", 0.1, 7, 0],
  ["2026-10-21", 9, "EURUSD", "SHORT", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "TP_HIT", 2.1, 3, 0],
  ["2026-10-23", 13, "XAUUSD", "SHORT", "OVERLAP", "Retracement NY", "Retracement EMA", "FOCUSED", true, "MANUAL", 1.4, 7, 0],
  // Week 6 — ONE busy overtrading day (6 trades, poor quality).
  ["2026-10-28", 8, "XAUUSD", "LONG", "ASIAN", "Retracement NY", "Retracement EMA", "BORED", false, "MANUAL", -0.4, 7, 0],
  ["2026-10-28", 9, "EURUSD", "LONG", "ASIAN", "Retracement NY", "Retracement EMA", "BORED", false, "SL_HIT", -1, 3, 0],
  ["2026-10-28", 13, "XAUUSD", "SHORT", "OVERLAP", "Breakout Londres", "Breakout range", "ANXIOUS", false, "MANUAL", -0.5, 7, 0],
  ["2026-10-28", 15, "EURUSD", "SHORT", "OVERLAP", "Retracement NY", "Biais HTF", "FOMO", false, "MANUAL", -0.6, 3, 0],
  ["2026-10-28", 17, "XAUUSD", "LONG", "NEW_YORK", "Retracement NY", "Biais HTF", "TIRED", false, "SL_HIT", -1, 7, 3],
  ["2026-10-28", 19, "XAUUSD", "LONG", "NEW_YORK", "Retracement NY", "Breakout range", "TIRED", false, "MANUAL", 0.2, 7, 0],
  // Week 7-8 — calm winners again (recent, lands in 30d).
  ["2026-11-03", 8, "XAUUSD", "LONG", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "TP_HIT", 2.4, 7, 0],
  ["2026-11-05", 9, "EURUSD", "SHORT", "LONDON", "Breakout Londres", "Breakout range", "CONFIDENT", true, "TRAILING", 2.8, 3, 0],
  ["2026-11-09", 8, "XAUUSD", "SHORT", "LONDON", "Breakout Londres", "Breakout range", "CALM", true, "TP_HIT", 1.7, 7, 0],
  ["2026-11-10", 13, "EURUSD", "LONG", "OVERLAP", "Retracement NY", "Retracement EMA", "FOCUSED", true, "MANUAL", 1.1, 3, 0],
  ["2026-11-12", 20, "XAUUSD", "SHORT", "NEW_YORK", "Retracement NY", "Biais HTF", "CALM", true, "TP_HIT", 1.5, 7, 0],
];

/** Symbol params: [entryPriceBase, lots, stopDistance] */
const SYMS: Record<string, { price: number; lots: string; stop: number; digits: number }> = {
  XAUUSD: { price: 2520, lots: "0.5", stop: 2.0, digits: 2 },
  EURUSD: { price: 1.082, lots: "1", stop: 0.001, digits: 5 },
};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const user = await db.user.findUnique({ where: { email: "demo@tradejournal.app" } });
  if (!user) {
    console.error("✗ Demo user not found — run `bun prisma/seed.ts` first.");
    process.exit(1);
  }
  const account = await db.account.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    console.error("✗ Demo user has no account.");
    process.exit(1);
  }

  const existing = await db.trade.count({
    where: { accountId: account.id, externalId: { startsWith: "demoan-" } },
  });
  if (existing > 0) {
    console.log(`✓ Already enriched (${existing} demoan- trades) — nothing to do.`);
    await db.$disconnect();
    return;
  }

  // Instruments visible to the user (own copies or global presets).
  const findInstrument = async (symbol: string) => {
    const inst = await db.instrument.findFirst({
      where: { symbol, OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { userId: "desc" }, // prefer the user's own copy
    });
    if (!inst) throw new Error(`Instrument ${symbol} not found — seed first.`);
    return inst;
  };
  const xau = await findInstrument("XAUUSD");
  const eur = await findInstrument("EURUSD");

  // Strategies (created when missing).
  const ensureStrategy = async (name: string, color: string, description: string) => {
    const found = await db.strategy.findFirst({ where: { userId: user.id, name } });
    if (found) return found;
    return db.strategy.create({
      data: { userId: user.id, name, color, description, status: "ACTIVE" },
    });
  };
  const breakout = await ensureStrategy(
    "Breakout Londres",
    "#10b981",
    "Cassure du range asiatique à l'ouverture de Londres, stop sous le range."
  );
  const retracement = await ensureStrategy(
    "Retracement NY",
    "#f59e0b",
    "Retracement sur EMA20 en tendance H1 pendant la session NY."
  );
  const stratByName: Record<string, string> = {
    "Breakout Londres": breakout.id,
    "Retracement NY": retracement.id,
  };

  const RISK = 100; // 1% of 10k
  let created = 0;
  for (const [i, row] of ROWS.entries()) {
    const [date, hour, sym, dir, session, strat, setup, emotion, plan, exit, r, commission, swap] = row;
    const inst = sym === "XAUUSD" ? xau : eur;
    const p = SYMS[sym];
    // Deterministic pseudo-variation of the entry price so the demo doesn't
    // look synthetic-flat, without any randomness (idempotent re-runs).
    const drift = ((i % 7) - 3) * (sym === "XAUUSD" ? 3 : 0.0008);
    const entry = p.price + drift;
    const signed = dir === "LONG" ? 1 : -1;
    const exitPx = entry + signed * p.stop * r;
    const stopPx = entry - signed * p.stop;
    const tpPx = entry + signed * p.stop * 2.5;
    const net = (r * RISK).toFixed(2);
    const result = r > 0.05 ? "WIN" : r < -0.05 ? "LOSS" : "BREAKEVEN";
    const entryTime = new Date(`${date}T${String(hour).padStart(2, "0")}:30:00.000Z`);
    const durationMin = 45 + ((i * 17) % 180);
    const exitTime = new Date(entryTime.getTime() + durationMin * 60_000);

    await db.trade.create({
      data: {
        userId: user.id,
        accountId: account.id,
        instrumentId: inst.id,
        strategyId: stratByName[strat] ?? null,
        externalId: `demoan-${String(i + 1).padStart(3, "0")}`,
        direction: dir,
        orderType: "MARKET",
        status: "CLOSED",
        timeframe: sym === "XAUUSD" ? "M15" : "M5",
        session,
        setupType: setup,
        entryTime,
        exitTime,
        entryPrice: entry.toFixed(p.digits),
        exitPrice: exitPx.toFixed(p.digits),
        stopLoss: stopPx.toFixed(p.digits),
        takeProfit: tpPx.toFixed(p.digits),
        lots: p.lots,
        riskAmount: RISK.toFixed(2),
        riskPercent: "1",
        accountBalanceAtEntry: "10000",
        netPnl: net,
        grossPnl: (r * RISK + commission + swap).toFixed(2),
        commission: commission.toFixed(2),
        swap: swap.toFixed(2),
        pnlCurrency: account.currency,
        rMultiple: r.toFixed(2),
        plannedRR: "2.5",
        resultType: result,
        pnlSource: "MANUAL",
        exitReason: exit,
        emotionBefore: emotion,
        followedPlan: plan,
        setupQualityRating: plan ? 4 : 2,
        executionRating: plan ? 4 : 2,
        source: "MANUAL",
        preTradeAnalysis: "",
        postTradeReview: "",
      },
    });
    created++;
  }

  console.log(`✓ ${created} trades enrichis sur « ${account.name} » (stratégies, émotions, plan, revenge, overtrading).`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("Enrich failed:", e);
  process.exit(1);
});
