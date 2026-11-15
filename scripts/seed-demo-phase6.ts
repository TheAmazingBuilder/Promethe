/**
 * Phase 6 demo enrichment — goals + trading rules for the demo user, then a
 * BULK re-evaluation so violations appear on the existing demo trades
 * (e.g. the big PROP losing days exceed the max daily loss rule).
 * IDEMPOTENT: keyed by goal name / (rule kind) / (user, date).
 *
 * Run: bun scripts/seed-demo-phase6.ts
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const DEMO_EMAIL = "demo@tradejournal.app";

function dayAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mirror of the production bulk detector (src/server/rules.ts) — the seed
 * script runs standalone with its own PrismaClient and cannot import app
 * modules compiled for Next. Same semantics: local-day bucketing in the
 * user's timezone, entry-count / exit-P&L aggregates, delete-then-insert. */
async function reevaluate(userId: string): Promise<void> {
  const profile = await db.profile.findUnique({ where: { id: userId } });
  const timezone = profile?.timezone ?? "UTC";
  const rules = await db.tradingRule.findMany({
    where: { userId, isActive: true },
  });
  const trades = await db.trade.findMany({
    where: { userId, isDraft: false, status: { in: ["OPEN", "CLOSED"] } },
    select: {
      id: true,
      status: true,
      isDraft: true,
      entryTime: true,
      exitTime: true,
      riskAmount: true,
      netPnl: true,
    },
  });

  const localDay = (d: Date): string | null => {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts: Record<string, string> = {};
      for (const p of fmt.formatToParts(d)) {
        if (p.type !== "literal") parts[p.type] = p.value;
      }
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      return null;
    }
  };

  const entryCount = new Map<string, number>();
  const exitPnl = new Map<string, string[]>();
  for (const t of trades) {
    const d = localDay(t.entryTime);
    if (d != null) entryCount.set(d, (entryCount.get(d) ?? 0) + 1);
    if (t.status === "CLOSED" && t.exitTime != null) {
      const e = localDay(t.exitTime);
      if (e != null) {
        const list = exitPnl.get(e) ?? [];
        list.push(t.netPnl?.toString() ?? "0");
        exitPnl.set(e, list);
      }
    }
  }

  const rows: Array<{ tradeId: string; ruleId: string; note: string }> = [];
  for (const t of trades) {
    const entryDay = localDay(t.entryTime);
    if (entryDay == null) continue;
    for (const r of rules) {
      if (r.kind === "CUSTOM") continue;
      const limit = Number(r.value);
      if (!(limit > 0)) continue;
      let violated = false;
      let measured = "";
      if (r.kind === "MAX_TRADES_PER_DAY") {
        const count = entryCount.get(entryDay) ?? 0;
        if (count > limit) {
          violated = true;
          measured = String(count);
        }
      } else if (r.kind === "MAX_DAILY_LOSS" && t.status === "CLOSED" && t.exitTime != null) {
        const day = localDay(t.exitTime);
        if (day != null) {
          const sum = (exitPnl.get(day) ?? []).reduce((a, b) => a + Number(b), 0);
          if (sum <= -limit) {
            violated = true;
            measured = String(sum);
          }
        }
      } else if (r.kind === "MAX_RISK_PER_TRADE" && t.riskAmount != null) {
        if (Number(t.riskAmount) > limit) {
          violated = true;
          measured = t.riskAmount.toString();
        }
      }
      if (violated) {
        rows.push({
          tradeId: t.id,
          ruleId: r.id,
          note: JSON.stringify({
            kind: r.kind,
            measured,
            limit: r.value.toString(),
          }),
        });
      }
    }
  }

  await db.$transaction(async (tx) => {
    await tx.tradeRuleViolation.deleteMany({ where: { trade: { userId } } });
    if (rows.length > 0) {
      await tx.tradeRuleViolation.createMany({ data: rows });
    }
  });
  console.log(`Violations rewritten: ${rows.length}`);
}

async function main() {
  const user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    console.log("Demo user not found — run bun prisma/seed.ts first.");
    return;
  }

  // ── Goals (name-keyed idempotence) ──
  const goals: Array<{
    name: string;
    description: string;
    metric: string;
    targetValue: string;
    period: string;
    startDate: string;
    status: string;
  }> = [
    {
      name: "P&L net mensuel +2 000 $",
      description: "Objectif principal du mois — un green month régulier avant d'augmenter la taille.",
      metric: "NET_PNL",
      targetValue: "2000",
      period: "MONTHLY",
      startDate: dayAgo(30),
      status: "ACTIVE",
    },
    {
      name: "Win rate ≥ 50 %",
      description: "Qualité des entrées : viser la cohérence plutôt que le taux parfait.",
      metric: "WIN_RATE",
      targetValue: "50",
      period: "MONTHLY",
      startDate: dayAgo(30),
      status: "ACTIVE",
    },
    {
      name: "R moyen ≥ 0.3",
      description: "Chaque trade doit rapporter en moyenne 0.3R — sinon revoir les sorties.",
      metric: "AVG_R",
      targetValue: "0.3",
      period: "MONTHLY",
      startDate: dayAgo(30),
      status: "ACTIVE",
    },
    {
      name: "Discipline ≥ 4/5",
      description: "Score moyen du journal — la discipline avant le P&L.",
      metric: "DISCIPLINE_SCORE",
      targetValue: "4",
      period: "WEEKLY",
      startDate: dayAgo(7),
      status: "ACTIVE",
    },
  ];
  let gCreated = 0;
  for (const g of goals) {
    const exists = await db.goal.findFirst({
      where: { userId: user.id, name: g.name },
      select: { id: true },
    });
    if (exists) continue;
    await db.goal.create({
      data: {
        userId: user.id,
        name: g.name,
        description: g.description,
        metric: g.metric,
        targetValue: g.targetValue,
        period: g.period,
        startDate: new Date(`${g.startDate}T00:00:00Z`),
        status: g.status,
      },
    });
    gCreated++;
  }
  console.log(`Goals created: ${gCreated} (skipped ${goals.length - gCreated})`);

  // ── Rules (one per kind, kind+description-keyed idempotence) ──
  const rules: Array<{
    kind: string;
    value: string;
    description: string;
  }> = [
    {
      kind: "MAX_TRADES_PER_DAY",
      value: "3",
      description: "Maximum 3 trades par jour — au-delà, la fatigue dégrade les décisions.",
    },
    {
      kind: "MAX_DAILY_LOSS",
      value: "1500",
      description: "Stop net journalier à −1 500 $ : arrêt immédiat, revue et retour demain.",
    },
    {
      kind: "MAX_RISK_PER_TRADE",
      value: "600",
      description: "Risque maximal de 600 $ par trade (0.6 % du compte de 100k).",
    },
    {
      kind: "CUSTOM",
      value: "1",
      description: "Aucune revenge trade dans les 15 minutes suivant une perte.",
    },
  ];
  let rCreated = 0;
  for (const r of rules) {
    const exists = await db.tradingRule.findFirst({
      where: { userId: user.id, kind: r.kind },
      select: { id: true },
    });
    if (exists) continue;
    await db.tradingRule.create({
      data: {
        userId: user.id,
        kind: r.kind,
        value: r.value,
        description: r.description,
        isActive: true,
      },
    });
    rCreated++;
  }
  console.log(`Rules created: ${rCreated} (skipped ${rules.length - rCreated})`);

  // ── Violations: bulk re-evaluation over the whole demo history ──
  await reevaluate(user.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
