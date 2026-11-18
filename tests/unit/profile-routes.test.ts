import { describe, expect, it } from "vitest";
import { parsePathname, routeToPath } from "@/lib/routes";

/**
 * Profile route — /settings/profile is a real clean URL. No test here
 * touches the database.
 */
describe("profile route", () => {
  it("parses /settings/profile into the profile-settings view", () => {
    expect(parsePathname("/settings/profile").view).toBe("profile-settings");
  });

  it("builds /settings/profile from the profile-settings view", () => {
    expect(routeToPath({ view: "profile-settings" })).toBe("/settings/profile");
  });

  it("keeps the neighbouring settings routes intact", () => {
    expect(parsePathname("/settings").view).toBe("settings");
    expect(parsePathname("/settings/account").view).toBe("account-settings");
    expect(parsePathname("/settings/integrations").view).toBe(
      "integrations-settings"
    );
    expect(routeToPath({ view: "account-settings" })).toBe("/settings/account");
  });
});
