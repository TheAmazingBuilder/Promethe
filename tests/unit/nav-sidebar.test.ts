import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  allNavItems,
  findNavItem,
  isGroupExpanded,
} from "../../src/components/app/nav";

/**
 * Sidebar slimming (Phase 1) + Strategies removal: 10 page entries visible
 * at a glance, the Data group collapsed by default behind one parent row,
 * every page still listed for the command palette and the mobile sheet.
 * Strategies has no sidebar entry (the Playbook already has a Strategies
 * tab) but stays reachable via the palette, search and its own route.
 */
describe("sidebar slimming", () => {
  it("lists every page for the command palette and the mobile sheet", () => {
    const items = allNavItems();
    // 18 visible pages + Profile settings (palette-only, added with the
    // Profile page) + Economic Calendar (palette-only, added with lot 10).
    expect(items).toHaveLength(20);
    const views = items.map((item) => item.view);
    for (const view of [
      "dashboard",
      "trades",
      "calendar",
      "prop-firms",
      "tools",
      "analytics",
      "journal",
      "strategies",
      "playbook",
      "gaia",
      "rules",
      "accounts",
      "instruments",
      "tags",
      "import",
      "broker-sync",
      "reconciliation",
      "settings",
      "profile-settings",
      "economic-calendar",
    ]) {
      expect(views).toContain(view);
    }
  });

  it("shows 10 page entries at a glance (Data behind one parent row)", () => {
    const visibleTopLevel: Array<{ key: string }> = NAV_GROUPS.flatMap(
      (group) =>
        group.collapsible
          ? [{ key: group.labelKey }]
          : group.items.map((item) => ({ key: item.view }))
    );
    // 11 page entries + the Data parent row.
    expect(visibleTopLevel).toHaveLength(12);
    const pageEntries = NAV_GROUPS.flatMap((group) =>
      group.collapsible ? [] : group.items
    );
    expect(pageEntries).toHaveLength(11);
    expect(
      pageEntries.map((item) => item.view)
    ).toEqual([
      "dashboard",
      "trades",
      "calendar",
      "prop-firms",
      "tools",
      "analytics",
      "journal",
      "playbook",
      "gaia",
      "rules",
      "settings",
    ]);
  });

  it("keeps the six Data pages as sub-entries of one collapsible group", () => {
    const dataGroups = NAV_GROUPS.filter(
      (group) => group.labelKey === "nav.groups.data"
    );
    expect(dataGroups).toHaveLength(1);
    const [data] = dataGroups;
    expect(data.collapsible).toBe(true);
    expect(data.icon).toBeDefined();
    expect(data.items.map((item) => item.view)).toEqual([
      "accounts",
      "instruments",
      "tags",
      "import",
      "broker-sync",
      "reconciliation",
    ]);
    // No other group is collapsible.
    expect(
      NAV_GROUPS.filter((group) => group.collapsible).map(
        (group) => group.labelKey
      )
    ).toEqual(["nav.groups.data"]);
  });

  it("resolves every page, including Data sub-entries, via findNavItem", () => {
    for (const item of allNavItems()) {
      expect(findNavItem(item.view)).toBe(item);
    }
    expect(findNavItem("accounts")?.path).toBe("/accounts");
    expect(findNavItem("settings")?.path).toBe("/settings");
    // Phase 2 — clean URLs: every nav path is a real App Router route,
    // no hash, no French slug.
    for (const item of allNavItems()) {
      expect(item.path.startsWith("#")).toBe(false);
      expect(item.path.startsWith("/")).toBe(true);
    }
  });

  it("keeps Strategies out of the sidebar but reachable via palette and search", () => {
    // No sidebar group lists Strategies (the Playbook tab covers it).
    const sidebarViews = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => item.view)
    );
    expect(sidebarViews).not.toContain("strategies");
    // ...but the route stays listed for the command palette and search,
    // and the header title still resolves.
    expect(allNavItems().map((item) => item.view)).toContain("strategies");
    expect(findNavItem("strategies")?.path).toBe("/strategies");
  });

  it("auto-expands a collapsed group when one of its pages is active", () => {
    // Stored collapsed, no active child: stays collapsed.
    expect(isGroupExpanded(true, false)).toBe(false);
    // Stored expanded: stays expanded.
    expect(isGroupExpanded(false, false)).toBe(true);
    // Active child always expands, even when stored collapsed.
    expect(isGroupExpanded(true, true)).toBe(true);
    expect(isGroupExpanded(false, true)).toBe(true);
  });
});
