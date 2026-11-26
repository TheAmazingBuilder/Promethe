/**
 * Lot 10 (roadmap section 12) - economic calendar: triple-source sync
 * (FRED + ForexFactory + manual), merge/dedupe, per-source health,
 * watchlist + trade links, pre-event alerts, cross-user isolation.
 *
 * Provider transport is stubbed (no network). All provider-fixture
 * events are dated in the PAST on purpose: provider rows are global
 * (userId null), and another test file asserts that a fresh user sees
 * no upcoming event (dashboard-data getRequirements). Future events in
 * this file are manual (user-scoped) only. afterAll removes every
 * global row and sync state this file created.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  autoLinkEventsForTrade,
  checkUpcomingEventAlerts,
  createManualEvent,
  deleteManualEvent,
  getTradeEventContext,
  getWatchlistPrefs,
  linkEventToTrade,
  listEconomicEvents,
  runEconomicCalendarSync,
  unlinkEventFromTrade,
  updateManualEvent,
  updateWatchlistPrefs,
} from "@/server/economic-calendar";

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

let instrumentId: string;
let userA: { id: string };
let userB: { id: string };
let accountAId: string;

const utcDay = (daysFromNow: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromNow)).toISOString().slice(0, 10);
};

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "Test1234!test",
    displayName: "Economic Calendar Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  return { user, accountId: accounts[0].id };
}

/** Stub transport: FRED fixtures + ForexFactory fixture, routed by URL. */
function stubFetchFactory(options?: { fredDown?: boolean; ffDown?: boolean }) {
  return async (input: string): Promise<Response> => {
    const url = input;
    if (url.includes("faireconomy")) {
      if (options?.ffDown) throw new Error("ForexFactory unreachable");
      return new Response(
        JSON.stringify([
          {
            title: "CPI m/m",
            country: "USD",
            date: `${utcDay(-1)}T08:30:00-05:00`,
            impact: "High",
            forecast: "0.3%",
            previous: "0.2%",
          },
          {
            title: "PPI m/m",
            country: "USD",
            date: `${utcDay(-1)}T08:30:00-05:00`,
            impact: "Medium",
            forecast: "0.4%",
            previous: "0.1%",
          },
          {
            title: "German Final GDP q/q",
            country: "EUR",
            date: `${utcDay(-1)}T02:00:00-05:00`,
            impact: "Low",
            forecast: "0.2%",
            previous: "0.2%",
          },
          {
            title: "FOMC Member Williams Speaks",
            country: "USD",
            date: `${utcDay(-1)}T16:00:00-05:00`,
            impact: "Low",
            forecast: "",
            previous: "",
          },
        ]),
        { status: 200 },
      );
    }
    if (url.includes("/releases/dates")) {
      if (options?.fredDown) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(
        JSON.stringify({
          release_dates: [
            { release_id: 10, release_name: "Consumer Price Index", date: utcDay(-1) },
            { release_id: 50, release_name: "Employment Situation", date: utcDay(-2) },
            { release_id: 42, release_name: "Producer Price Index", date: "2026-11-01" },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/release/series")) {
      return new Response(
        JSON.stringify({ seriess: [{ id: "CPIAUCSL", title: "Consumer Price Index", units: "Index" }] }),
        { status: 200 },
      );
    }
    if (url.includes("/series/observations")) {
      return new Response(
        JSON.stringify({
          observations: [
            { date: utcDay(-30), value: "324.8" },
            { date: utcDay(-60), value: "323.9" },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

async function makeTrade(entryTime: Date) {
  return db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      direction: "LONG",
      status: "CLOSED",
      entryTime,
      exitTime: new Date(entryTime.getTime() + 2 * 60 * 60 * 1000),
      entryPrice: "2650",
      exitPrice: "2660",
      lots: "0.1",
      netPnl: "100",
      pnlCurrency: "USD",
      rMultiple: "1",
      resultType: "WIN",
      followedPlan: true,
      riskPercent: "1",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
}

beforeAll(async () => {
  process.env.FRED_API_KEY = "test-key";
  const existing = await db.instrument.findFirst({ where: { symbol: "XAUUSD", userId: null } });
  const instrument = existing ?? (await db.instrument.create({ data: { userId: null, ...XAUUSD_SPEC } }));
  instrumentId = instrument.id;
  const a = await makeUser("econ-cal-a@test.local");
  const b = await makeUser("econ-cal-b@test.local");
  userA = a.user;
  userB = b.user;
  accountAId = a.accountId;
});

afterAll(async () => {
  // Provider rows are global: remove every row this file created so no
  // other test file ever sees them.
  await db.tradeEventLink.deleteMany({ where: { trade: { userId: { in: [userA.id, userB.id] } } } });
  await db.economicEvent.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await db.economicEvent.deleteMany({ where: { userId: null } });
  await db.economicCalendarSyncState.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  delete process.env.FRED_API_KEY;
});

describe("triple-source sync and merge", () => {
  it("keeps a manual event untouched when a provider reports the same release", async () => {
    // The manual PPI is created BEFORE any sync: the sync must skip it.
    const manual = await createManualEvent(userA.id, {
      title: "PPI m/m",
      currency: "USD",
      country: "US",
      impact: "HIGH",
      category: "PPI",
      scheduledAt: new Date(`${utcDay(-1)}T13:30:00.000Z`).toISOString(),
      actual: "9.9%",
    });
    expect(manual.isManual).toBe(true);

    const report = await runEconomicCalendarSync({ fetchImpl: stubFetchFactory(), force: true });
    const fred = report.sources.find((entry) => entry.source === "FRED");
    const ff = report.sources.find((entry) => entry.source === "FOREXFACTORY");
    expect(fred?.status).toBe("OK");
    expect(ff?.status).toBe("OK");

    const kept = await db.economicEvent.findUnique({ where: { id: manual.id } });
    expect(kept?.source).toBe("MANUAL");
    expect(kept?.actual).toBe("9.9%");
    expect(kept?.impact).toBe("HIGH");
  });

  it("merges the same release from FRED and ForexFactory into one row", async () => {
    const rows = await db.economicEvent.findMany({
      where: { title: "CPI m/m", userId: null },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Actual from FRED (official series), forecast + impact from ForexFactory.
    expect(row.actual).toBe("324.8");
    expect(row.forecast).toBe("0.3%");
    expect(row.previous).toBe("323.9");
    expect(row.impact).toBe("HIGH");
    expect(row.source).toBe("FRED");
    expect(row.scheduledAt.toISOString()).toBe(`${utcDay(-1)}T13:30:00.000Z`);
    const meta = JSON.parse(row.sourceMeta ?? "{}") as Record<string, unknown>;
    expect(meta.FRED).toBeDefined();
    expect(meta.FOREXFACTORY).toBeDefined();
  });

  it("stores the DST edge correctly (Nov 1 2026, fall-back day)", async () => {
    const row = await db.economicEvent.findFirst({
      where: {
        title: "PPI m/m",
        userId: null,
        country: "US",
        scheduledAt: { gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-11-02T00:00:00.000Z") },
      },
    });
    // The FRED PPI release of 2026-11-01 at 08:30 ET is 13:30 UTC (EST).
    expect(row?.scheduledAt.toISOString()).toBe("2026-11-01T13:30:00.000Z");
  });

  it("keeps provider rows for the other currencies", async () => {
    const eur = await db.economicEvent.findMany({
      where: { currency: "EUR", userId: null },
    });
    expect(eur.length).toBeGreaterThanOrEqual(1);
    expect(eur[0].title).toContain("GDP");
  });
});

describe("per-source health", () => {
  it("reports FRED NOT_CONFIGURED without a key while ForexFactory still syncs", async () => {
    delete process.env.FRED_API_KEY;
    const report = await runEconomicCalendarSync({ fetchImpl: stubFetchFactory(), force: true });
    const fred = report.sources.find((entry) => entry.source === "FRED");
    const ff = report.sources.find((entry) => entry.source === "FOREXFACTORY");
    expect(fred?.status).toBe("NOT_CONFIGURED");
    expect(ff?.status).toBe("OK");
    process.env.FRED_API_KEY = "test-key";
  });

  it("reports ForexFactory DOWN on a dead feed while FRED still syncs", async () => {
    const report = await runEconomicCalendarSync({
      fetchImpl: stubFetchFactory({ ffDown: true }),
      force: true,
    });
    const fred = report.sources.find((entry) => entry.source === "FRED");
    const ff = report.sources.find((entry) => entry.source === "FOREXFACTORY");
    expect(fred?.status).toBe("OK");
    expect(ff?.status).toBe("DOWN");
    expect(ff?.error).toMatch(/unreachable/);
  });

  it("reports FRED DOWN on a 403 while ForexFactory still syncs", async () => {
    const report = await runEconomicCalendarSync({
      fetchImpl: stubFetchFactory({ fredDown: true }),
      force: true,
    });
    const fred = report.sources.find((entry) => entry.source === "FRED");
    const ff = report.sources.find((entry) => entry.source === "FOREXFACTORY");
    expect(fred?.status).toBe("DOWN");
    expect(ff?.status).toBe("OK");
  });
});

describe("list, filters and visibility", () => {
  it("shows global events to every user and manual events only to their owner", async () => {
    const forA = await listEconomicEvents(userA.id, {});
    const forB = await listEconomicEvents(userB.id, {});
    expect(forA.some((event) => event.title === "CPI m/m")).toBe(true);
    expect(forB.some((event) => event.title === "CPI m/m")).toBe(true);
    // The manual PPI belongs to A only.
    expect(forA.some((event) => event.title === "PPI m/m" && event.isManual)).toBe(true);
    expect(forB.some((event) => event.title === "PPI m/m" && event.isManual)).toBe(false);
  });

  it("filters by currency and by unrated impact", async () => {
    const eur = await listEconomicEvents(userA.id, { currencies: ["EUR"] });
    expect(eur.length).toBeGreaterThan(0);
    expect(eur.every((event) => event.currency === "EUR")).toBe(true);
    const unrated = await listEconomicEvents(userA.id, { impacts: ["UNRATED"] });
    // FRED-only rows (Employment Situation has no ForexFactory match and
    // no impact rating) surface as unrated.
    expect(unrated.some((event) => event.title === "Non-Farm Employment Change")).toBe(true);
    expect(unrated.every((event) => event.impact == null)).toBe(true);
    const high = await listEconomicEvents(userA.id, { impacts: ["HIGH"] });
    expect(high.every((event) => event.impact === "HIGH")).toBe(true);
  });

  it("applies the watchlist as a filter", async () => {
    // The only EUR event in the fixture (German Final GDP) is LOW
    // impact, so the watchlist min impact must be LOW for it to show.
    await updateWatchlistPrefs(userA.id, {
      currencies: ["EUR"],
      categories: [],
      minImpact: "LOW",
      alertsEnabled: true,
      alertMinutesBefore: 60,
    });
    const watched = await listEconomicEvents(userA.id, { watchlistOnly: true });
    expect(watched.length).toBeGreaterThan(0);
    expect(watched.every((event) => event.currency === "EUR")).toBe(true);
    await updateWatchlistPrefs(userA.id, {
      currencies: ["USD"],
      categories: [],
      minImpact: "MEDIUM",
      alertsEnabled: true,
      alertMinutesBefore: 60,
    });
  });
});

describe("manual events", () => {
  it("creates, updates and deletes only the owner's events", async () => {
    const created = await createManualEvent(userA.id, {
      title: "ECB Rate Decision",
      currency: "EUR",
      country: "EU",
      impact: "HIGH",
      category: "RATE_DECISION",
      scheduledAt: new Date(`${utcDay(-1)}T12:15:00.000Z`).toISOString(),
    });
    // B cannot see it.
    expect(await listEconomicEvents(userB.id, {})).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
    // B cannot update or delete it.
    await expect(
      updateManualEvent(userB.id, created.id, {
        title: "ECB Rate Decision",
        currency: "EUR",
        country: "EU",
        impact: "LOW",
        category: "RATE_DECISION",
        scheduledAt: new Date(`${utcDay(-1)}T12:15:00.000Z`).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(await deleteManualEvent(userB.id, created.id)).toBe(false);

    const updated = await updateManualEvent(userA.id, created.id, {
      title: "ECB Rate Decision",
      currency: "EUR",
      country: "EU",
      impact: "HIGH",
      category: "RATE_DECISION",
      scheduledAt: new Date(`${utcDay(-1)}T12:15:00.000Z`).toISOString(),
      forecast: "2.00%",
    });
    expect(updated.forecast).toBe("2.00%");
    expect(await deleteManualEvent(userA.id, created.id)).toBe(true);
    expect(await deleteManualEvent(userA.id, created.id)).toBe(false);
  });

  it("refuses a manual event that duplicates an existing release", async () => {
    await expect(
      createManualEvent(userA.id, {
        title: "CPI m/m",
        currency: "USD",
        country: "US",
        impact: "HIGH",
        category: "CPI",
        scheduledAt: new Date(`${utcDay(-1)}T13:30:00.000Z`).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "EVENT_ALREADY_EXISTS" });
  });
});

describe("watchlist preferences", () => {
  it("returns defaults, then the saved prefs, scoped per user", async () => {
    const defaults = await getWatchlistPrefs(userB.id);
    expect(defaults.currencies).toEqual(["USD"]);
    expect(defaults.minImpact).toBe("MEDIUM");
    expect(defaults.alertsEnabled).toBe(true);
    expect(defaults.alertMinutesBefore).toBe(60);

    const saved = await updateWatchlistPrefs(userB.id, {
      currencies: ["USD", "EUR"],
      categories: ["CPI"],
      minImpact: "HIGH",
      alertsEnabled: false,
      alertMinutesBefore: 30,
    });
    expect(saved.currencies).toEqual(["USD", "EUR"]);
    expect(saved.categories).toEqual(["CPI"]);
    expect(saved.alertsEnabled).toBe(false);
    // A's prefs are untouched.
    const aPrefs = await getWatchlistPrefs(userA.id);
    expect(aPrefs.currencies).toEqual(["USD"]);
  });
});

describe("trade links and market context", () => {
  it("auto-links nearby events with BEFORE / DURING / AFTER phases", async () => {
    const entry = new Date();
    entry.setUTCMinutes(0, 0, 0);
    const trade = await makeTrade(entry);
    const before = await createManualEvent(userA.id, {
      title: "Event After Entry",
      currency: "USD",
      country: "US",
      impact: "LOW",
      category: "OTHER",
      scheduledAt: new Date(entry.getTime() + 60 * 60 * 1000).toISOString(),
    });
    const during = await createManualEvent(userA.id, {
      title: "Event At Entry",
      currency: "USD",
      country: "US",
      impact: "LOW",
      category: "OTHER",
      scheduledAt: entry.toISOString(),
    });
    const after = await createManualEvent(userA.id, {
      title: "Event Before Entry",
      currency: "USD",
      country: "US",
      impact: "LOW",
      category: "OTHER",
      scheduledAt: new Date(entry.getTime() - 30 * 60 * 1000).toISOString(),
    });

    const linked = await autoLinkEventsForTrade(userA.id, trade.id);
    expect(linked).toBe(3);

    const context = await getTradeEventContext(userA.id, trade.id);
    expect(context).not.toBeNull();
    expect(context?.snapshot).toBeNull();
    const phases = new Map(context?.events.map((item) => [item.id, item.phase]));
    expect(phases.get(before.id)).toBe("BEFORE");
    expect(phases.get(during.id)).toBe("DURING");
    expect(phases.get(after.id)).toBe("AFTER");

    // Manual unlink, then manual re-link.
    expect(await unlinkEventFromTrade(userA.id, trade.id, during.id)).toBe(true);
    const relinked = await linkEventToTrade(userA.id, trade.id, during.id);
    expect(relinked.phase).toBe("DURING");
    expect(relinked.autoLinked).toBe(false);

    // B cannot link to A's trade, and cannot read A's context.
    await expect(linkEventToTrade(userB.id, trade.id, during.id)).rejects.toMatchObject({
      code: "TRADE_NOT_FOUND",
    });
    expect(await getTradeEventContext(userB.id, trade.id)).toBeNull();
  });
});

describe("pre-event alerts", () => {
  it("notifies once for an event inside the window, never outside it", async () => {
    await updateWatchlistPrefs(userA.id, {
      currencies: ["USD"],
      categories: [],
      minImpact: "MEDIUM",
      alertsEnabled: true,
      alertMinutesBefore: 60,
    });
    const soon = await createManualEvent(userA.id, {
      title: "Alert Test Release",
      currency: "USD",
      country: "US",
      impact: "HIGH",
      category: "CPI",
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    await createManualEvent(userA.id, {
      title: "Far Away Release",
      currency: "USD",
      country: "US",
      impact: "HIGH",
      category: "CPI",
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    });

    const countFor = async (title: string) =>
      db.notificationLog.count({
        where: { userId: userA.id, type: "ECONOMIC_EVENT_SOON", title: { contains: title } },
      });

    expect(await checkUpcomingEventAlerts(new Date())).toBe(1);
    expect(await countFor("Alert Test Release")).toBe(1);
    expect(await countFor("Far Away Release")).toBe(0);
    // Second run inside the dedupe window: no duplicate.
    expect(await checkUpcomingEventAlerts(new Date())).toBe(0);
    expect(await countFor("Alert Test Release")).toBe(1);

    await deleteManualEvent(userA.id, soon.id);
  });
});
