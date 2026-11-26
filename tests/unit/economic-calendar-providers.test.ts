/**
 * Lot 10 (roadmap section 12) - economic calendar providers: dedupe key,
 * category classification, FRED curated map, merge precedence, timezone
 * conversion (incl. DST edges), ForexFactory payload parsing, FRED fetch
 * with a stubbed transport. No DB, no network.
 */
import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  classifyCategory,
  mapFredRelease,
  mergeProviderEvent,
  passesMinImpact,
  slugifyTitle,
  zonedTimeToUtc,
  type NormalizedEconomicEvent,
} from "@/lib/economic-calendar/providers";
import { fetchFredEvents } from "@/lib/economic-calendar/fred";
import { parseForexFactoryPayload } from "@/lib/economic-calendar/forexfactory";

describe("buildDedupeKey", () => {
  it("keys the same real-world event identically", () => {
    const a = buildDedupeKey("CPI m/m", new Date("2026-11-25T13:30:00.000Z"), "USD");
    const b = buildDedupeKey("CPI m/m", new Date("2026-11-25T08:30:00.000Z"), "USD");
    expect(a).toBe(b);
    expect(a).toBe("cpi-m-m|2026-11-25|USD");
  });

  it("separates different days, titles and currencies", () => {
    const base = buildDedupeKey("CPI m/m", new Date("2026-11-25T13:30:00.000Z"), "USD");
    expect(buildDedupeKey("CPI m/m", new Date("2026-12-10T13:30:00.000Z"), "USD")).not.toBe(base);
    expect(buildDedupeKey("CPI y/y", new Date("2026-11-25T13:30:00.000Z"), "USD")).not.toBe(base);
    expect(buildDedupeKey("CPI m/m", new Date("2026-11-25T13:30:00.000Z"), "EUR")).not.toBe(base);
  });

  it("keys FRED and ForexFactory spellings of the same release identically", () => {
    // FRED says country "US", ForexFactory's country field holds the
    // currency code "USD": the key uses the currency, so both spellings
    // merge into one row.
    const fred = buildDedupeKey("CPI m/m", new Date("2026-11-25T13:30:00.000Z"), "USD");
    const ff = buildDedupeKey("CPI m/m", new Date("2026-11-25T13:30:00.000Z"), "USD");
    expect(fred).toBe(ff);
    expect(fred).toBe("cpi-m-m|2026-11-25|USD");
  });

  it("slugifies titles", () => {
    expect(slugifyTitle("Non-Farm Employment Change")).toBe("non-farm-employment-change");
    expect(slugifyTitle("  Core PCE Price Index m/m  ")).toBe("core-pce-price-index-m-m");
  });
});

describe("classifyCategory", () => {
  it("classifies the headline releases", () => {
    expect(classifyCategory("CPI m/m")).toBe("CPI");
    expect(classifyCategory("Consumer Price Index")).toBe("CPI");
    expect(classifyCategory("Non-Farm Employment Change")).toBe("NFP");
    expect(classifyCategory("Unemployment Rate")).toBe("NFP");
    expect(classifyCategory("FOMC Meeting Minutes")).toBe("FOMC");
    expect(classifyCategory("Gross Domestic Product")).toBe("GDP");
    expect(classifyCategory("Flash Manufacturing PMI")).toBe("PMI");
    expect(classifyCategory("Retail Sales m/m")).toBe("RETAIL_SALES");
    expect(classifyCategory("FOMC Member Williams Speaks")).toBe("FOMC");
    expect(classifyCategory("German ifo Business Climate")).toBe("OTHER");
  });
});

describe("mapFredRelease", () => {
  it("maps curated releases to canonical titles", () => {
    expect(mapFredRelease("Consumer Price Index")).toEqual({
      keyword: "consumer price index",
      title: "CPI m/m",
      category: "CPI",
    });
    expect(mapFredRelease("Employment Situation")).toMatchObject({
      title: "Non-Farm Employment Change",
      category: "NFP",
    });
    expect(mapFredRelease("Gross Domestic Product")).toMatchObject({
      title: "GDP q/q",
      category: "GDP",
    });
  });

  it("drops releases outside the curated map", () => {
    expect(mapFredRelease("Money Zero Maturity (MZM)")).toBeNull();
    expect(mapFredRelease("Failures and Assistance Transactions")).toBeNull();
  });
});

describe("zonedTimeToUtc", () => {
  it("converts 08:30 ET to UTC across DST", () => {
    // Winter (EST, UTC-5): 08:30 -> 13:30 UTC.
    expect(zonedTimeToUtc("2026-11-25", 8, 30, "America/New_York").toISOString()).toBe(
      "2026-11-25T13:30:00.000Z",
    );
    // Summer (EDT, UTC-4): 08:30 -> 12:30 UTC.
    expect(zonedTimeToUtc("2026-07-15", 8, 30, "America/New_York").toISOString()).toBe(
      "2026-07-15T12:30:00.000Z",
    );
  });

  it("lands on the right side of the fall-back transition", () => {
    // 2026-11-01: clocks go back at 02:00 ET. 08:30 that day is EST.
    expect(zonedTimeToUtc("2026-11-01", 8, 30, "America/New_York").toISOString()).toBe(
      "2026-11-01T13:30:00.000Z",
    );
    // The day before is still EDT.
    expect(zonedTimeToUtc("2026-10-31", 8, 30, "America/New_York").toISOString()).toBe(
      "2026-10-31T12:30:00.000Z",
    );
  });

  it("converts 08:30 ET on the spring-forward day", () => {
    // 2026-03-08: clocks go forward at 02:00 ET. 08:30 that day is EDT.
    expect(zonedTimeToUtc("2026-03-08", 8, 30, "America/New_York").toISOString()).toBe(
      "2026-03-08T12:30:00.000Z",
    );
  });
});

describe("passesMinImpact", () => {
  it("unrated events always pass (importance unknown, never hidden)", () => {
    expect(passesMinImpact(null, "HIGH")).toBe(true);
    expect(passesMinImpact(null, "MEDIUM")).toBe(true);
  });

  it("compares rated impacts", () => {
    expect(passesMinImpact("HIGH", "MEDIUM")).toBe(true);
    expect(passesMinImpact("LOW", "HIGH")).toBe(false);
    expect(passesMinImpact("MEDIUM", "MEDIUM")).toBe(true);
  });
});

function fredEvent(partial: Partial<NormalizedEconomicEvent> = {}): NormalizedEconomicEvent {
  return {
    externalId: "fred:10:2026-11-25",
    title: "CPI m/m",
    currency: "USD",
    country: "US",
    impact: null,
    category: "CPI",
    scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
    actual: "0.3%",
    forecast: null,
    previous: "0.2%",
    unit: "Percent",
    ...partial,
  };
}

function ffEvent(partial: Partial<NormalizedEconomicEvent> = {}): NormalizedEconomicEvent {
  return {
    externalId: "cpi-m-m|2026-11-25|USD",
    title: "CPI m/m",
    currency: "USD",
    country: "US",
    impact: "HIGH",
    category: "CPI",
    scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
    actual: null,
    forecast: "0.3%",
    previous: "0.2%",
    unit: null,
    ...partial,
  };
}

describe("mergeProviderEvent", () => {
  const now = new Date("2026-11-25T15:00:00.000Z");

  it("merges FRED actuals onto a ForexFactory row (forecast and impact kept)", () => {
    const merged = mergeProviderEvent(
      {
        source: "FOREXFACTORY",
        scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
        actual: null,
        forecast: "0.3%",
        previous: "0.2%",
        impact: "HIGH",
        sourceMeta: {
          FOREXFACTORY: { updatedAt: "2026-11-25T10:00:00.000Z", externalId: "cpi-m-m|2026-11-25|USD" },
        },
      },
      { ...fredEvent(), source: "FRED" as const },
      now,
    );
    expect(merged.actual).toBe("0.3%");
    expect(merged.forecast).toBe("0.3%");
    expect(merged.previous).toBe("0.2%");
    expect(merged.impact).toBe("HIGH");
    expect(merged.source).toBe("FRED");
    expect(merged.sourceMeta.FRED).toBeDefined();
    expect(merged.sourceMeta.FOREXFACTORY).toBeDefined();
  });

  it("merges ForexFactory forecast and impact onto a FRED row", () => {
    const merged = mergeProviderEvent(
      {
        source: "FRED",
        scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
        actual: "0.3%",
        forecast: null,
        previous: "0.2%",
        impact: null,
        sourceMeta: {
          FRED: { updatedAt: "2026-11-25T10:00:00.000Z", externalId: "fred:10:2026-11-25" },
        },
      },
      { ...ffEvent(), source: "FOREXFACTORY" as const },
      now,
    );
    expect(merged.actual).toBe("0.3%");
    expect(merged.forecast).toBe("0.3%");
    expect(merged.impact).toBe("HIGH");
    expect(merged.source).toBe("FRED");
  });

  it("keeps the ForexFactory exact time on the same day", () => {
    const merged = mergeProviderEvent(
      {
        source: "FRED",
        scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
        actual: null,
        forecast: null,
        previous: null,
        impact: null,
        sourceMeta: {},
      },
      {
        ...ffEvent({ scheduledAt: new Date("2026-11-25T15:00:00.000Z") }),
        source: "FOREXFACTORY" as const,
      },
      now,
    );
    expect(merged.scheduledAt.toISOString()).toBe("2026-11-25T15:00:00.000Z");
  });

  it("keeps the official FRED date when the sources disagree on the day", () => {
    const merged = mergeProviderEvent(
      {
        source: "FRED",
        scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
        actual: null,
        forecast: null,
        previous: null,
        impact: null,
        sourceMeta: {},
      },
      {
        ...ffEvent({ scheduledAt: new Date("2026-11-26T13:30:00.000Z") }),
        source: "FOREXFACTORY" as const,
      },
      now,
    );
    expect(merged.scheduledAt.toISOString()).toBe("2026-11-25T13:30:00.000Z");
  });

  it("never drops an actual when the fresh FRED fetch has none yet", () => {
    const merged = mergeProviderEvent(
      {
        source: "FRED",
        scheduledAt: new Date("2026-11-25T13:30:00.000Z"),
        actual: "0.3%",
        forecast: null,
        previous: "0.2%",
        impact: null,
        sourceMeta: {},
      },
      { ...fredEvent({ actual: null, previous: null }), source: "FRED" as const },
      now,
    );
    expect(merged.actual).toBe("0.3%");
    expect(merged.previous).toBe("0.2%");
  });
});

describe("parseForexFactoryPayload", () => {
  it("parses the real feed shape", () => {
    const events = parseForexFactoryPayload([
      { title: "CPI m/m", country: "USD", date: "2026-11-25T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.2%" },
      { title: "Core PCE Price Index m/m", country: "USD", date: "2026-11-25T08:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.3%" },
      { title: "Bank Holiday", country: "JPY", date: "2026-11-22T19:00:00-05:00", impact: "Holiday", forecast: "", previous: "" },
    ]);
    expect(events).toHaveLength(3);
    expect(events[0].scheduledAt.toISOString()).toBe("2026-11-25T13:30:00.000Z");
    expect(events[0].impact).toBe("HIGH");
    expect(events[0].actual).toBeNull();
    expect(events[0].category).toBe("CPI");
    expect(events[2].impact).toBe("LOW");
    expect(events[2].forecast).toBeNull();
  });

  it("throws on a non-array payload (feed shape changed)", () => {
    expect(() => parseForexFactoryPayload({ calendar: [] })).toThrow();
  });

  it("skips rows with missing fields or an unparsable date", () => {
    const events = parseForexFactoryPayload([
      { title: "CPI m/m", country: "USD", date: "not-a-date", impact: "High", forecast: "0.3%", previous: "0.2%" },
      { title: "", country: "USD", date: "2026-11-25T08:30:00-05:00", impact: "High", forecast: "", previous: "" },
      { title: "PPI m/m", country: "USD", date: "2026-11-25T08:30:00-05:00", impact: "Medium", forecast: "0.4%", previous: "0.1%" },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("PPI m/m");
  });
});

describe("fetchFredEvents (stubbed transport)", () => {
  const datesFixture = {
    realtime_start: "2026-11-18",
    realtime_end: "2026-12-30",
    release_dates: [
      { release_id: 10, release_name: "Consumer Price Index", date: "2026-11-25" },
      { release_id: 50, release_name: "Employment Situation", date: "2026-12-04" },
      { release_id: 61, release_name: "Money Zero Maturity (MZM)", date: "2026-11-25" },
    ],
  };

  function stubFetch(url: string): Promise<Response> {
    let body: unknown;
    if (url.includes("/releases/dates")) body = datesFixture;
    else if (url.includes("/release/series")) {
      body = { seriess: [{ id: "CPIAUCSL", title: "Consumer Price Index", units: "Index" }] };
    } else if (url.includes("/series/observations")) {
      body = {
        observations: [
          { date: "2026-10-01", value: "324.8" },
          { date: "2026-09-01", value: "323.9" },
        ],
      };
    } else {
      body = {};
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }

  it("keeps only curated releases, with actual + previous from the series", async () => {
    const result = await fetchFredEvents({
      apiKey: "test-key",
      from: "2026-11-18",
      to: "2026-12-30",
      today: "2026-11-25",
      fetchImpl: stubFetch,
    });
    expect(result.seenReleases).toBe(3);
    expect(result.keptReleases).toBe(2);
    expect(result.events).toHaveLength(2);
    const cpi = result.events.find((event) => event.title === "CPI m/m");
    expect(cpi).toBeDefined();
    expect(cpi?.scheduledAt.toISOString()).toBe("2026-11-25T13:30:00.000Z");
    expect(cpi?.actual).toBe("324.8");
    expect(cpi?.previous).toBe("323.9");
    expect(cpi?.forecast).toBeNull();
    expect(cpi?.impact).toBeNull();
    expect(cpi?.currency).toBe("USD");
    // The December release has not happened yet: no actual.
    const nfp = result.events.find((event) => event.title === "Non-Farm Employment Change");
    expect(nfp?.actual).toBeNull();
  });

  it("fails softly when the API answers with an error", async () => {
    const failing: (url: string) => Promise<Response> = () =>
      Promise.resolve(new Response("forbidden", { status: 403 }));
    await expect(
      fetchFredEvents({
        apiKey: "bad-key",
        from: "2026-11-18",
        to: "2026-12-30",
        today: "2026-11-25",
        fetchImpl: failing,
      }),
    ).rejects.toThrow(/403/);
  });
});
