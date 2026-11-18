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
    // 17 visible pages + Mentor Space (mentorOnly, hidden by default).
    expect(items).toHaveLength(18);
    const views = items.map((item) => item.view);
    for (const view of [
      "dashboard",
      "trades",
      "calendar",
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
      "mentor",
      "settings",
    ]) {
      expect(views).toContain(view);
    }
  });

  it("shows 10 page entries at a glance (Data behind one parent row)", () => {
    const visibleTopLevel: Array<{ key: string }> = NAV_GROUPS.flatMap(
      (group) =>
        group.collapsible
          ? [{ key: group.labelKey }]
          : group.items
              .filter((item) => !item.mentorOnly)
              .map((item) => ({ key: item.view }))
    );
    // 10 page entries + the Data parent row.
    expect(visibleTopLevel).toHaveLength(11);
    const pageEntries = NAV_GROUPS.flatMap((group) =>
      group.collapsible
        ? []
        : group.items.filter((item) => !item.mentorOnly)
    );
    expect(pageEntries).toHaveLength(10);
    expect(
      pageEntries.map((item) => item.view)
    ).toEqual([
      "dashboard",
      "trades",
      "calendar",
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
    expect(findNavItem("accounts")?.path).toBe("#/comptes");
    expect(findNavItem("settings")?.path).toBe("#/reglages");
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
    expect(findNavItem("strategies")?.path).toBe("#/strategies");
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
