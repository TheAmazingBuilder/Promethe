/**
 * Integration test — USER ISOLATION for the v2.5 Module 2 tables
 * (SavedChart, ChartAnnotation, BenchmarkProfile) through the data-access
 * layer in /src/server/charts.ts (sandbox equivalent of RLS, spec §1).
 *
 * Pattern (addendum §11.8): user A creates rows; user B must never read,
 * update or delete them through the same server functions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name)
        ? { name, value: cookieStore.get(name)! }
        : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createSavedChart,
  deleteSavedChart,
  getSavedChart,
  listSavedCharts,
  updateSavedChart,
} from "@/server/charts";

let userA: { id: string; email: string };
let userB: { id: string; email: string };

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "alice-charts@test.local",
    password: "password1",
    displayName: "Alice",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "bob-charts@test.local",
    password: "password1",
    displayName: "Bob",
    timezone: "Europe/Paris",
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

const VALID_CONFIG = {
  x: "hourOfDay",
  y: "rMultiple",
  aggregation: "avg",
  chartType: "bar",
  groupBy: "none",
  sort: "natural",
  minSampleSize: 0,
  showTrendLine: false,
  period: "all",
} as const;

describe("SavedChart isolation (server data-access layer)", () => {
  it("B cannot read, update or delete A's saved chart", async () => {
    const chart = await createSavedChart(userA.id, {
      name: "A's chart",
      config: VALID_CONFIG,
    });

    // READ — B's list does not contain it; B's get returns null.
    expect(await listSavedCharts(userB.id)).toHaveLength(0);
    expect(await getSavedChart(userB.id, chart.id)).toBeNull();

    // UPDATE — B's update is a no-op returning null, A's name unchanged.
    expect(
      await updateSavedChart(userB.id, chart.id, { name: "Hacked" })
    ).toBeNull();
    const stillA = await getSavedChart(userA.id, chart.id);
    expect(stillA?.name).toBe("A's chart");

    // DELETE — B's delete reports false; A still sees the chart.
    expect(await deleteSavedChart(userB.id, chart.id)).toBe(false);
    expect(await getSavedChart(userA.id, chart.id)).not.toBeNull();

    // A can update and delete their own chart.
    const renamed = await updateSavedChart(userA.id, chart.id, {
      name: "Renamed",
    });
    expect(renamed?.name).toBe("Renamed");
    expect(await deleteSavedChart(userA.id, chart.id)).toBe(true);
    expect(await getSavedChart(userA.id, chart.id)).toBeNull();
  });

  it("configs are stored as validated JSON and round-trip", async () => {
    const chart = await createSavedChart(userA.id, {
      name: "Scatter config",
      config: { ...VALID_CONFIG, x: "tradeIndex", chartType: "scatter" },
    });
    const loaded = await getSavedChart(userA.id, chart.id);
    expect(loaded?.config).toMatchObject({
      x: "tradeIndex",
      chartType: "scatter",
      sort: "natural",
    });
    await deleteSavedChart(userA.id, chart.id);
  });
});

describe("ChartAnnotation & BenchmarkProfile isolation (DB-scoped pattern)", () => {
  it("B's scoped queries never see A's annotations/benchmarks; deletes scope by userId", async () => {
    const annotation = await db.chartAnnotation.create({
      data: {
        userId: userA.id,
        date: new Date("2025-03-01T00:00:00.000Z"),
        label: "Strategy change",
        kind: "STRATEGY_CHANGE",
        scope: "GLOBAL",
      },
    });
    const benchmark = await db.benchmarkProfile.create({
      data: {
        userId: userA.id,
        name: "1%/month",
        type: "FIXED_PERCENT_PER_PERIOD",
        params: JSON.stringify({
          percent: 1,
          period: "MONTH",
          compounding: true,
        }),
      },
    });

    // READ — B sees nothing.
    expect(
      await db.chartAnnotation.findMany({ where: { userId: userB.id } })
    ).toHaveLength(0);
    expect(
      await db.benchmarkProfile.findMany({ where: { userId: userB.id } })
    ).toHaveLength(0);
    expect(
      await db.chartAnnotation.findFirst({
        where: { id: annotation.id, userId: userB.id },
      })
    ).toBeNull();

    // DELETE — scoped deleteMany removes nothing for B.
    expect(
      await db.chartAnnotation.deleteMany({
        where: { id: annotation.id, userId: userB.id },
      })
    ).toMatchObject({ count: 0 });
    expect(
      await db.benchmarkProfile.deleteMany({
        where: { id: benchmark.id, userId: userB.id },
      })
    ).toMatchObject({ count: 0 });
    expect(
      await db.chartAnnotation.findUnique({ where: { id: annotation.id } })
    ).not.toBeNull();

    // Cascade: deleting user A removes A's rows.
    await db.user.delete({ where: { id: userA.id } }).catch(() => undefined);
    expect(
      await db.chartAnnotation.findUnique({ where: { id: annotation.id } })
    ).toBeNull();
    expect(
      await db.benchmarkProfile.findUnique({ where: { id: benchmark.id } })
    ).toBeNull();
  });
});
