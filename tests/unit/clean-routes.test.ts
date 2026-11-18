import { describe, expect, it } from "vitest";
import {
  canonicalPathFor,
  parseHash,
  parsePathname,
  resolveNavigationTarget,
  routeToPath,
} from "@/lib/routes";

/**
 * Clean-URL routing (Phase 2) — the pure route module. Legacy hash URLs
 * (including the old French slugs) must parse to the same routes as the
 * new clean paths, and routeToPath must only ever produce clean English
 * URLs. No test here touches the database.
 */
describe("parsePathname — clean English routes", () => {
  it("maps the main pages", () => {
    expect(parsePathname("/").view).toBe("dashboard");
    expect(parsePathname("/trades").view).toBe("trades");
    expect(parsePathname("/calendar").view).toBe("calendar");
    expect(parsePathname("/tools").view).toBe("tools");
    expect(parsePathname("/analytics").view).toBe("analytics");
    expect(parsePathname("/journal").view).toBe("journal");
    expect(parsePathname("/strategies").view).toBe("strategies");
    expect(parsePathname("/playbook").view).toBe("playbook");
    expect(parsePathname("/gaia").view).toBe("gaia");
    expect(parsePathname("/rules").view).toBe("rules");
    expect(parsePathname("/accounts").view).toBe("accounts");
    expect(parsePathname("/instruments").view).toBe("instruments");
    expect(parsePathname("/tags").view).toBe("tags");
    expect(parsePathname("/import").view).toBe("import");
    expect(parsePathname("/broker-sync").view).toBe("broker-sync");
    expect(parsePathname("/reconciliation").view).toBe("reconciliation");
    expect(parsePathname("/settings").view).toBe("settings");
    expect(parsePathname("/mentor").view).toBe("mentor");
    expect(parsePathname("/search").view).toBe("search");
    expect(parsePathname("/history").view).toBe("history");
    expect(parsePathname("/trash").view).toBe("trash");
    expect(parsePathname("/focus").view).toBe("focus");
  });

  it("parses the trades subtree", () => {
    expect(parsePathname("/trades/abc")).toMatchObject({
      view: "trade",
      id: "abc",
    });
    expect(parsePathname("/trades/new")).toMatchObject({
      view: "trade-form",
      mode: "create",
    });
    expect(parsePathname("/trades/abc/edit")).toMatchObject({
      view: "trade-form",
      mode: "edit",
      id: "abc",
    });
    expect(parsePathname("/trades/quick").view).toBe("quick-trade");
    expect(parsePathname("/trades", new URLSearchParams("symbol=XAUUSD")).query).toMatchObject({
      symbol: "XAUUSD",
    });
  });

  it("parses analytics, tools, settings and legal sub-pages", () => {
    expect(parsePathname("/analytics/anomalies").view).toBe("analytics-anomalies");
    expect(parsePathname("/analytics/charts").view).toBe("analytics-charts");
    expect(parsePathname("/tools/risk-reward")).toMatchObject({
      view: "tools",
      query: { tab: "risk-reward" },
    });
    expect(
      parsePathname("/tools", new URLSearchParams("tab=margin")).query
    ).toMatchObject({ tab: "margin" });
    expect(parsePathname("/settings/broker-sync").view).toBe("broker-sync");
    expect(parsePathname("/settings/account").view).toBe("account-settings");
    expect(parsePathname("/settings/sharing").view).toBe("sharing");
    expect(parsePathname("/settings/time").view).toBe("time-settings");
    expect(parsePathname("/settings/custom-fields").view).toBe("custom-fields-settings");
    expect(parsePathname("/settings/shortcuts").view).toBe("shortcuts-settings");
    expect(parsePathname("/legal/terms")).toMatchObject({
      view: "legal",
      legalPage: "terms",
    });
    expect(parsePathname("/legal/privacy").legalPage).toBe("privacy");
    expect(parsePathname("/legal/cookies").legalPage).toBe("cookies");
  });

  it("parses journal dates, mentor space, invitations and Gaïa deep links", () => {
    expect(parsePathname("/journal/2026-11-17")).toMatchObject({
      view: "journal",
      journalDate: "2026-11-17",
    });
    expect(parsePathname("/mentor/o1")).toMatchObject({
      view: "mentor-owner",
      ownerId: "o1",
    });
    expect(parsePathname("/mentor/o1/trades/t9")).toMatchObject({
      view: "mentor-trade",
      ownerId: "o1",
      id: "t9",
    });
    expect(parsePathname("/invitation/tok")).toMatchObject({
      view: "invitation",
      token: "tok",
    });
    expect(
      parsePathname("/gaia", new URLSearchParams("tab=notes&note=abc")).query
    ).toMatchObject({ tab: "notes", note: "abc" });
    expect(
      parsePathname("/playbook", new URLSearchParams("tab=setups")).query
    ).toMatchObject({ tab: "setups" });
  });

  it("falls back to the dashboard for unknown paths", () => {
    expect(parsePathname("/nope").view).toBe("dashboard");
  });
});

describe("parseHash — legacy URLs keep working", () => {
  it("maps old French slugs to the English views", () => {
    expect(parseHash("#/calendrier").view).toBe("calendar");
    expect(parseHash("#/outils").view).toBe("tools");
    expect(parseHash("#/outils/marge")).toMatchObject({
      view: "tools",
      query: { tab: "margin" },
    });
    expect(parseHash("#/outils/risque-recompense")).toMatchObject({
      view: "tools",
      query: { tab: "risk-reward" },
    });
    expect(parseHash("#/reglages").view).toBe("settings");
    expect(parseHash("#/reglages/compte").view).toBe("account-settings");
    expect(parseHash("#/reglages/broker-sync").view).toBe("broker-sync");
    expect(parseHash("#/reglages/champs-personnalises").view).toBe(
      "custom-fields-settings"
    );
    expect(parseHash("#/reglages/raccourcis").view).toBe("shortcuts-settings");
    expect(parseHash("#/reglages/heure").view).toBe("time-settings");
    expect(parseHash("#/reglages/partage").view).toBe("sharing");
    expect(parseHash("#/regles").view).toBe("rules");
    expect(parseHash("#/comptes").view).toBe("accounts");
    expect(parseHash("#/importer").view).toBe("import");
    expect(parseHash("#/legal/mentions").legalPage).toBe("terms");
    expect(parseHash("#/legal/confidentialite").legalPage).toBe("privacy");
  });

  it("keeps query params and detail ids", () => {
    expect(parseHash("#/trades/abc/edit")).toMatchObject({
      view: "trade-form",
      mode: "edit",
      id: "abc",
    });
    expect(parseHash("#/trades?symbol=XAUUSD").query).toMatchObject({
      symbol: "XAUUSD",
    });
    expect(parseHash("#/gaia?note=x&tab=notes").query).toMatchObject({
      note: "x",
      tab: "notes",
    });
    expect(parseHash("#/invitation/tok").token).toBe("tok");
  });
});

describe("routeToPath — canonical clean URLs only", () => {
  it("never produces a hash or a French slug", () => {
    const cases: Array<[string, string]> = [
      ["#/calendrier", "/calendar"],
      ["#/outils", "/tools"],
      ["#/outils/marge", "/tools/margin"],
      ["#/outils/risque-recompense", "/tools/risk-reward"],
      ["#/reglages", "/settings"],
      ["#/reglages/compte", "/settings/account"],
      ["#/reglages/broker-sync", "/broker-sync"],
      ["#/regles", "/rules"],
      ["#/comptes", "/accounts"],
      ["#/importer", "/import"],
      ["#/legal/mentions", "/legal/terms"],
      ["#/legal/confidentialite", "/legal/privacy"],
      ["#/trades", "/trades"],
      ["#/trades/abc", "/trades/abc"],
      ["#/trades/abc/edit", "/trades/abc/edit"],
      ["#/trades/quick", "/trades/quick"],
      ["#/journal/2026-11-17", "/journal/2026-11-17"],
      ["#/mentor/o1/trades/t9", "/mentor/o1/trades/t9"],
      ["#/invitation/tok", "/invitation/tok"],
      ["#/", "/"],
    ];
    for (const [legacy, clean] of cases) {
      expect(routeToPath(parseHash(legacy))).toBe(clean);
    }
  });

  it("preserves query params (Playbook tabs, Gaïa deep links, drill-downs)", () => {
    expect(routeToPath(parseHash("#/playbook?tab=setups"))).toBe(
      "/playbook?tab=setups"
    );
    expect(routeToPath(parseHash("#/gaia?note=x&tab=notes"))).toBe(
      "/gaia?note=x&tab=notes"
    );
    expect(routeToPath(parseHash("#/trades?symbol=XAUUSD"))).toBe(
      "/trades?symbol=XAUUSD"
    );
    expect(routeToPath(parseHash("#/?p=30d&a=all&d=abc"))).toBe(
      "/?p=30d&a=all&d=abc"
    );
  });
});

describe("canonicalPathFor + resolveNavigationTarget", () => {
  it("canonicalizes legacy French pathnames", () => {
    expect(canonicalPathFor("/calendrier")).toBe("/calendar");
    expect(canonicalPathFor("/outils")).toBe("/tools");
    expect(canonicalPathFor("/reglages")).toBe("/settings");
    expect(canonicalPathFor("/settings/broker-sync")).toBe("/broker-sync");
    expect(
      canonicalPathFor("/tools", new URLSearchParams("tab=margin"))
    ).toBe("/tools/margin");
  });

  it("leaves canonical, public and API paths alone", () => {
    expect(canonicalPathFor("/trades")).toBeNull();
    expect(canonicalPathFor("/")).toBeNull();
    expect(canonicalPathFor("/tools/risk-reward")).toBeNull();
    expect(canonicalPathFor("/s/abc123")).toBeNull();
    expect(canonicalPathFor("/api/legal")).toBeNull();
    expect(canonicalPathFor("/unknown-page")).toBeNull();
  });

  it("normalizes every navigation target form", () => {
    expect(resolveNavigationTarget("#/trades")).toBe("/trades");
    expect(resolveNavigationTarget("#/calendrier")).toBe("/calendar");
    expect(resolveNavigationTarget("trades")).toBe("/trades");
    expect(resolveNavigationTarget("/trades?symbol=XAUUSD")).toBe(
      "/trades?symbol=XAUUSD"
    );
    expect(resolveNavigationTarget("/")).toBe("/");
  });
});
