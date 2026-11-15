/**
 * Seed: global instrument presets (userId = null), global preset tags,
 * and a local demo account for immediate testing.
 * Idempotent: creates only what is missing, never overwrites user edits.
 * Run with: bun prisma/seed.ts
 */
import { db } from "../src/lib/db";
import { PRESET_INSTRUMENTS } from "../src/lib/trading/instruments";
import { PRESET_TAGS } from "../src/lib/trading/tags";
import { createUserWithDefaults, ensureUserSetup } from "../src/server/users";

const DEMO_EMAIL = "demo@tradejournal.app";
const DEMO_PASSWORD = "demo1234";

async function seedInstruments(): Promise<number> {
  let created = 0;
  for (const preset of PRESET_INSTRUMENTS) {
    const existing = await db.instrument.findFirst({
      where: { userId: null, symbol: preset.symbol },
      select: { id: true },
    });
    if (existing) continue;
    await db.instrument.create({
      data: {
        userId: null,
        symbol: preset.symbol,
        name: preset.name,
        assetClass: preset.assetClass,
        baseCurrency: preset.baseCurrency,
        quoteCurrency: preset.quoteCurrency,
        digits: preset.digits,
        pipSize: preset.pipSize, // string → exact Decimal
        pointSize: preset.pointSize,
        contractSize: preset.contractSize,
        tickSize: preset.tickSize ?? null,
        tickValue: preset.tickValue ?? null,
        isActive: true,
      },
    });
    created++;
  }
  return created;
}

async function seedTags(): Promise<number> {
  let created = 0;
  for (const tag of PRESET_TAGS) {
    const existing = await db.tag.findFirst({
      where: { userId: null, name: tag.name },
      select: { id: true },
    });
    if (existing) continue;
    await db.tag.create({
      data: { userId: null, name: tag.name, kind: tag.kind, color: tag.color },
    });
    created++;
  }
  return created;
}

async function seedDemoUser(): Promise<"created" | "present"> {
  const existing = await db.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  if (existing) {
    // Repair profile/account if a legacy row is missing them.
    await ensureUserSetup(existing.id).catch(() => undefined);
    return "present";
  }
  await createUserWithDefaults({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    displayName: "Trader Démo",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "fr",
  });
  return "created";
}

async function main() {
  console.log("→ Seeding global instruments…");
  const instruments = await seedInstruments();
  console.log(`  ✓ ${instruments} instrument(s) créé(s)`);

  console.log("→ Seeding global tags…");
  const tags = await seedTags();
  console.log(`  ✓ ${tags} tag(s) créé(s)`);

  console.log("→ Seeding demo user…");
  const demo = await seedDemoUser();
  console.log(
    demo === "created"
      ? `  ✓ Créé : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`
      : "  ✓ Déjà présent"
  );

  const totals = await Promise.all([
    db.instrument.count({ where: { userId: null } }),
    db.tag.count({ where: { userId: null } }),
  ]);
  console.log(
    `\nBase seedée : ${totals[0]} instruments globaux, ${totals[1]} tags globaux, compte démo prêt.`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
