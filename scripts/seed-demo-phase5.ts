/**
 * Phase 5 demo enrichment — adds a PROP challenge account (with closed
 * trades approaching the limits), and a few journal entries for the demo
 * user. IDEMPOTENT: keyed by account name / externalId / (user, date).
 *
 * Run: bun scripts/seed-demo-phase5.ts
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const DEMO_EMAIL = "demo@tradejournal.app";
const PROP_NAME = "Défi PROP — 100k";

/** ISO date of today minus n days (local server date). */
function dayAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function at(day: string, hourUtc: number): Date {
  return new Date(`${day}T${String(hourUtc).padStart(2, "0")}:30:00Z`);
}

async function main() {
  const user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    console.log("Demo user not found — run bun prisma/seed.ts first.");
    return;
  }
  const instrument = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  if (!instrument) throw new Error("XAUUSD preset missing");

  // ── PROP account ──
  let account = await db.account.findFirst({
    where: { userId: user.id, name: PROP_NAME },
  });
  if (!account) {
    account = await db.account.create({
      data: {
        userId: user.id,
        name: PROP_NAME,
        broker: "FTMO",
        type: "PROP",
        currency: "USD",
        initialBalance: "100000",
        maxDailyLossPercent: "5",
        maxTotalDrawdownPercent: "10",
        profitTarget: "10000",
        drawdownType: "STATIC",
        startDate: at(dayAgo(20), 0),
      },
    });
    console.log("PROP account created:", account.id);
  } else {
    console.log("PROP account already present:", account.id);
  }

  // ── PROP trades (externalId-keyed idempotence) ──
  // Story: climbed to +1 900 (peak 101 900), then gave back — total net
  // −7 700 → STATIC drawdown 7 700 (77% of the 10k limit → WARNING zone),
  // and −2 200 closed today (44% of the daily limit → OK).
  const propTrades: Array<{
    externalId: string;
    day: string;
    hour: number;
    netPnl: string;
    rMultiple: string;
  }> = [
    { externalId: "propdemo-1", day: dayAgo(18), hour: 14, netPnl: "450", rMultiple: "1.5" },
    { externalId: "propdemo-2", day: dayAgo(17), hour: 15, netPnl: "-200", rMultiple: "-1" },
    { externalId: "propdemo-3", day: dayAgo(15), hour: 13, netPnl: "600", rMultiple: "2" },
    { externalId: "propdemo-4", day: dayAgo(12), hour: 16, netPnl: "700", rMultiple: "2.2" },
    { externalId: "propdemo-5", day: dayAgo(11), hour: 14, netPnl: "350", rMultiple: "1.1" },
    { externalId: "propdemo-6", day: dayAgo(8), hour: 15, netPnl: "-1100", rMultiple: "-2.8" },
    { externalId: "propdemo-7", day: dayAgo(6), hour: 17, netPnl: "-2000", rMultiple: "-1.9" },
    { externalId: "propdemo-8", day: dayAgo(4), hour: 13, netPnl: "-1700", rMultiple: "-2.4" },
    { externalId: "propdemo-9", day: dayAgo(2), hour: 16, netPnl: "-2600", rMultiple: "-3.1" },
    { externalId: "propdemo-10", day: dayAgo(0), hour: 14, netPnl: "-2200", rMultiple: "-2.6" },
  ];

  let created = 0;
  for (const t of propTrades) {
    const exists = await db.trade.findFirst({
      where: { userId: user.id, externalId: t.externalId },
      select: { id: true },
    });
    if (exists) continue;
    const exit = at(t.day, t.hour);
    await db.trade.create({
      data: {
        userId: user.id,
        accountId: account.id,
        instrumentId: instrument.id,
        externalId: t.externalId,
        direction: Number(t.netPnl) >= 0 ? "LONG" : "SHORT",
        status: "CLOSED",
        entryTime: new Date(exit.getTime() - 2 * 3600_000),
        exitTime: exit,
        entryPrice: "2345.00",
        exitPrice: "2351.80",
        stopLoss: "2340.00",
        lots: "0.5",
        pips: "68",
        netPnl: t.netPnl,
        rMultiple: t.rMultiple,
        resultType: Number(t.netPnl) > 0 ? "WIN" : "LOSS",
        preTradeAnalysis: "",
        postTradeReview: "",
        source: "EA_SYNC",
      },
    });
    created++;
  }
  console.log(`PROP trades created: ${created} (skipped ${propTrades.length - created})`);

  // ── Journal entries ──
  const entries: Array<{
    date: string;
    mood: number;
    sleep: number;
    discipline: number;
    bias: string;
    lesson: string;
  }> = [
    {
      date: dayAgo(2),
      mood: 2,
      sleep: 3,
      discipline: 2,
      bias: "Baissier — mais j'ai tradé à contre-biais",
      lesson: "Ne pas chercher des longs le jour d'une cassure majeure.",
    },
    {
      date: dayAgo(1),
      mood: 3,
      sleep: 4,
      discipline: 3,
      bias: "Neutre — attendre la réaction sur 2 330",
      lesson: "Réduire la taille après deux pertes consécutives.",
    },
    {
      date: dayAgo(0),
      mood: 3,
      sleep: 4,
      discipline: 4,
      bias: "Baissier tant que 2 345 tient",
      lesson: "Le plan était bon, la sortie précipitée a coûté 0.8R.",
    },
  ];
  let jCreated = 0;
  for (const e of entries) {
    const exists = await db.journalEntry.findFirst({
      where: { userId: user.id, date: e.date },
      select: { id: true },
    });
    if (exists) continue;
    await db.journalEntry.create({
      data: {
        userId: user.id,
        date: e.date,
        mood: e.mood,
        sleepQuality: e.sleep,
        disciplineScore: e.discipline,
        marketBias: e.bias,
        keyLesson: e.lesson,
        preMarketPlan:
          "Plan : ne trader qu'après la réaction de Londres sur les niveaux HTF. Risque max 0.5 % par trade, 2 setups maximum.",
        postMarketReview:
          "Exécution correcte sur le premier setup, sortie trop hâtive sur le second. Aucune revenge trade — progrès.",
      },
    });
    jCreated++;
  }
  console.log(`Journal entries created: ${jCreated} (skipped ${entries.length - jCreated})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
