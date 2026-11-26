/**
 * §20 - Template duplication: trade templates and journal templates.
 *
 * Proves against PostgreSQL schema promethe_test:
 *  1. A duplicated trade template is a fresh row (new id, usageCount 0,
 *     lastUsedAt null, name suffixed " (copy)") carrying the source fields.
 *  2. A duplicated journal template is never the default; the source
 *     keeps its default status.
 *  3. Ownership: duplicating another user's template (or a missing one)
 *     returns null.
 *  4. Long names are truncated before the " (copy)" suffix.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createTemplate, duplicateTemplate } from "@/server/templates";
import {
  createJournalTemplate,
  duplicateJournalTemplate,
  updateJournalTemplate,
} from "@/server/journal";

let userA: { id: string; email: string };
let userB: { id: string; email: string };

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "templates-a@test.local",
    password: "password1",
    displayName: "Templates A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "templates-b@test.local",
    password: "password1",
    displayName: "Templates B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("duplicate trade template", () => {
  it("copies the fields, resets usage, suffixes the name", async () => {
    const source = await createTemplate(userA.id, {
      name: "London breakout",
      direction: "LONG",
      defaultRiskPercent: "1",
      defaultStopLossPips: "15",
      defaultTagIds: [],
      defaultChecklistItemIds: [],
    });
    const copy = await duplicateTemplate(userA.id, source.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.name).toBe("London breakout (copy)");
    expect(copy!.direction).toBe("LONG");
    expect(copy!.defaultRiskPercent).toBe("1");
    expect(copy!.defaultStopLossPips).toBe("15");
    expect(copy!.usageCount).toBe(0);
    expect(copy!.lastUsedAt).toBeNull();
    await db.tradeTemplate.deleteMany({
      where: { id: { in: [source.id, copy!.id] } },
    });
  });

  it("refuses another user's template and a missing id", async () => {
    const source = await createTemplate(userA.id, {
      name: "Private template",
      defaultTagIds: [],
      defaultChecklistItemIds: [],
    });
    expect(await duplicateTemplate(userB.id, source.id)).toBeNull();
    expect(
      await duplicateTemplate(userA.id, "00000000-0000-0000-0000-000000000000")
    ).toBeNull();
    await db.tradeTemplate.delete({ where: { id: source.id } });
  });

  it("truncates a long name before adding the suffix", async () => {
    const source = await createTemplate(userA.id, {
      name: "a".repeat(80),
      defaultTagIds: [],
      defaultChecklistItemIds: [],
    });
    const copy = await duplicateTemplate(userA.id, source.id);
    expect(copy!.name).toBe(`${"a".repeat(72)} (copy)`);
    expect(copy!.name.length).toBe(79);
    await db.tradeTemplate.deleteMany({
      where: { id: { in: [source.id, copy!.id] } },
    });
  });
});

describe("duplicate journal template", () => {
  it("never copies the default flag; the source keeps it", async () => {
    const source = await createJournalTemplate(userA.id, {
      name: "Morning prep",
      marketBias: "BULLISH",
    });
    await updateJournalTemplate(userA.id, source.id, { isDefault: true });
    const copy = await duplicateJournalTemplate(userA.id, source.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.name).toBe("Morning prep (copy)");
    expect(copy!.marketBias).toBe("BULLISH");
    expect(copy!.isDefault).toBe(false);
    const stillDefault = await db.journalTemplate.findUnique({
      where: { id: source.id },
    });
    expect(stillDefault?.isDefault).toBe(true);
    await db.journalTemplate.deleteMany({
      where: { id: { in: [source.id, copy!.id] } },
    });
  });

  it("refuses another user's template and a missing id", async () => {
    const source = await createJournalTemplate(userA.id, {
      name: "Private journal",
    });
    expect(await duplicateJournalTemplate(userB.id, source.id)).toBeNull();
    expect(
      await duplicateJournalTemplate(
        userA.id,
        "00000000-0000-0000-0000-000000000000"
      )
    ).toBeNull();
    await db.journalTemplate.delete({ where: { id: source.id } });
  });

  it("truncates a long name before adding the suffix", async () => {
    const source = await createJournalTemplate(userA.id, {
      name: "b".repeat(60),
    });
    const copy = await duplicateJournalTemplate(userA.id, source.id);
    expect(copy!.name).toBe(`${"b".repeat(52)} (copy)`);
    expect(copy!.name.length).toBe(59);
    await db.journalTemplate.deleteMany({
      where: { id: { in: [source.id, copy!.id] } },
    });
  });
});
