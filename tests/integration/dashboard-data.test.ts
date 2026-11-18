/**
 * Phase 2 perf item 5 — dashboard getDashboardData (db/test.db).
 *
 * The closed-trade dataset is bounded in SQL by the union window
 * (earliest instant any widget reads, comparison windows included) and
 * the union of account scopes; OPEN rows load once up front; widgets
 * that read no dataset skip their query; requirements resolve in one
 * $transaction batch. Widget results must be identical to the old
 * unscoped in-JS behaviour.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  getDashboardData,
  getRequirements,
  type KpiWidgetData,
} from "@/server/dashboard-data";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Gold / US Dollar",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.10",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: "0.01",
  isActive: true,
};

let user: { id: string };
let accountA: string;
let accountB: string;
let dashboardId: string;
let staticOnlyId: string;
let openOnlyId: string;
let widgetIds: Record<string, string> = {};
let tradeIds: Record<string, string> = {};

async function seedTrade(
  key: string,
  data: Parameters<typeof db.trade.create>[0]["data"]
) {
  const row = await db.trade.create({ data });
  tradeIds[key] = row.id;
  return row;
}

beforeAll(async () => {
  const existing = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  const instrument =
    existing ??
    (await db.instrument.create({
      data: { userId: null, ...XAUUSD_SPEC },
    }));

  const created = await createUserWithDefaults({
    email: "dashboard-data@test.local",
    password: "test-password-123",
    displayName: "Dashboard Data Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  user = created.user;
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  accountA = accounts[0].id;
  const accountBRow = await db.account.create({
    data: { userId: user.id, name: "Second", currency: "USD", initialBalance: "10000" },
  });
  accountB = accountBRow.id;

  const base = {
    userId: user.id,
    instrumentId: instrument.id,
    direction: "LONG",
    status: "CLOSED",
    entryPrice: "2000",
    lots: "1",
    followedPlan: true,
    riskPercent: "1",
    preTradeAnalysis: "",
    postTradeReview: "",
  } as const;
  // Recent window (last30): A wins +100, B loses -50.
  await seedTrade("recentA", {
    ...base,
    accountId: accountA,
    session: "LONDON",
    entryTime: new Date(Date.UTC(2026, 10, 12, 14, 0, 0)),
    exitTime: new Date(Date.UTC(2026, 10, 12, 16, 0, 0)),
    exitPrice: "2010",
    netPnl: "100",
    rMultiple: "1",
    resultType: "WIN",
  });
  await seedTrade("recentB", {
    ...base,
    accountId: accountB,
    session: "LONDON",
    entryTime: new Date(Date.UTC(2026, 10, 13, 14, 0, 0)),
    exitTime: new Date(Date.UTC(2026, 10, 13, 16, 0, 0)),
    exitPrice: "1995",
    netPnl: "-50",
    rMultiple: "-0.5",
    resultType: "LOSS",
  });
  // Outside last30: A wins +500 (June 2025).
  await seedTrade("oldA", {
    ...base,
    accountId: accountA,
    session: "LONDON",
    entryTime: new Date(Date.UTC(2025, 5, 10, 14, 0, 0)),
    exitTime: new Date(Date.UTC(2025, 5, 10, 16, 0, 0)),
    exitPrice: "2050",
    netPnl: "500",
    rMultiple: "5",
    resultType: "WIN",
  });
  // Compare window of last30 ([2026-09-20, 2026-10-20)): A wins +20.
  await seedTrade("compareA", {
    ...base,
    accountId: accountA,
    session: "LONDON",
    entryTime: new Date(Date.UTC(2026, 9, 5, 14, 0, 0)),
    exitTime: new Date(Date.UTC(2026, 9, 5, 16, 0, 0)),
    exitPrice: "2002",
    netPnl: "20",
    rMultiple: "0.2",
    resultType: "WIN",
  });
  // One open trade on A.
  await seedTrade("openA", {
    ...base,
    accountId: accountA,
    status: "OPEN",
    session: "LONDON",
    entryTime: new Date(Date.UTC(2026, 10, 17, 14, 0, 0)),
    exitTime: null,
    exitPrice: null,
    netPnl: null,
    rMultiple: null,
    resultType: null,
  });

  const dashboard = await db.dashboard.create({
    data: { userId: user.id, name: "Perf Test", order: 0 },
  });
  dashboardId = dashboard.id;
  const addWidget = async (
    key: string,
    type: string,
    extra: { periodOverride?: string | null; accountOverride?: string | null } = {}
  ) => {
    const w = await db.dashboardWidget.create({
      data: {
        dashboardId,
        userId: user.id,
        type,
        title: key,
        config: "{}",
        layouts: "{}",
        periodOverride: extra.periodOverride ?? null,
        accountOverride: extra.accountOverride ?? null,
      },
    });
    widgetIds[key] = w.id;
    return w;
  };
  await addWidget("kpi", "kpi-strip");
  await addWidget("recent", "recent-trades");
  await addWidget("open", "open-trades");
  await addWidget("compare", "period-compare", {
    periodOverride: JSON.stringify({
      mode: "INHERIT",
      compareToPrevious: true,
    }),
  });

  const staticOnly = await db.dashboard.create({
    data: { userId: user.id, name: "Static Only", order: 1 },
  });
  staticOnlyId = staticOnly.id;
  await db.dashboardWidget.create({
    data: {
      dashboardId: staticOnlyId,
      userId: user.id,
      type: "sticky-note",
      title: "note",
      config: "{}",
      layouts: "{}",
    },
  });

  const openOnly = await db.dashboard.create({
    data: { userId: user.id, name: "Open Only", order: 2 },
  });
  openOnlyId = openOnly.id;
  await db.dashboardWidget.create({
    data: {
      dashboardId: openOnlyId,
      userId: user.id,
      type: "open-trades",
      title: "open",
      config: "{}",
      layouts: "{}",
    },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [user.id] } } });
  await db.$disconnect();
});

describe("dashboard dataset scoping (SQL, not JS)", () => {
  it("last30 excludes the old trade but keeps the compare window", async () => {
    const payload = await getDashboardData(user.id, dashboardId, {
      preset: "last30",
      accountId: null,
    });
    const kpi = payload.widgets[widgetIds.kpi].data as KpiWidgetData;
    expect(kpi.stats.tradeCount).toBe(2);
    expect(kpi.stats.netPnl).toBe("50");
    const recent = payload.widgets[widgetIds.recent].data as {
      trades: Array<{ id: string }>;
    };
    expect(recent.trades.map((t) => t.id).sort()).toEqual(
      [tradeIds.recentA, tradeIds.recentB].sort()
    );
    const compare = payload.widgets[widgetIds.compare].data as KpiWidgetData;
    expect(compare.compare?.stats.tradeCount).toBe(1);
    expect(compare.compare?.stats.netPnl).toBe("20");
    const open = payload.widgets[widgetIds.open].data as {
      openPositions: Array<{ id: string }>;
    };
    expect(open.openPositions.map((t) => t.id)).toEqual([tradeIds.openA]);
    expect(payload.requirements.savedCharts).toBe(false);
    expect(payload.requirements.metrics).toBe(false);
  });

  it("all loads the whole history (old trade included)", async () => {
    const payload = await getDashboardData(user.id, dashboardId, {
      preset: "all",
      accountId: null,
    });
    const kpi = payload.widgets[widgetIds.kpi].data as KpiWidgetData;
    expect(kpi.stats.tradeCount).toBe(4);
    expect(kpi.stats.netPnl).toBe("570");
  });

  it("global account filter scopes every widget", async () => {
    const payload = await getDashboardData(user.id, dashboardId, {
      preset: "last30",
      accountId: accountA,
    });
    const kpi = payload.widgets[widgetIds.kpi].data as KpiWidgetData;
    expect(kpi.stats.tradeCount).toBe(1);
    expect(kpi.stats.netPnl).toBe("100");
    const recent = payload.widgets[widgetIds.recent].data as {
      trades: Array<{ id: string }>;
    };
    expect(recent.trades.map((t) => t.id)).toEqual([tradeIds.recentA]);
    const open = payload.widgets[widgetIds.open].data as {
      openPositions: Array<{ id: string }>;
    };
    expect(open.openPositions.map((t) => t.id)).toEqual([tradeIds.openA]);
  });

  it("a static-only dashboard needs no trade dataset", async () => {
    const payload = await getDashboardData(user.id, staticOnlyId, {
      preset: "last30",
      accountId: null,
    });
    const entries = Object.values(payload.widgets);
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual({ data: null, error: null });
  });

  it("an open-only dashboard loads OPEN rows but no closed dataset", async () => {
    const payload = await getDashboardData(user.id, openOnlyId, {
      preset: "last30",
      accountId: null,
    });
    const entries = Object.values(payload.widgets);
    expect(entries.length).toBe(1);
    const open = entries[0].data as { openPositions: Array<{ id: string }> };
    expect(open.openPositions.map((t) => t.id)).toEqual([tradeIds.openA]);
  });
});

describe("getRequirements", () => {
  it("returns all flags false for a fresh user", async () => {
    const reqs = await getRequirements(user.id);
    expect(reqs).toEqual({
      prop: false,
      news: false,
      sync: false,
      goals: false,
      metrics: false,
      savedCharts: false,
    });
  });
});
