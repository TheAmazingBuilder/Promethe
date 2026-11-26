import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gaiaView = readFileSync(
  new URL("../../src/components/gaia/gaia-view.tsx", import.meta.url),
  "utf8"
);
const gaiaEditor = readFileSync(
  new URL("../../src/components/gaia/gaia-editor.tsx", import.meta.url),
  "utf8"
);

describe("Gaïa query error recovery", () => {
  it("does not render the empty overview tabs when the overview request fails", () => {
    expect(gaiaView).toContain("overviewQuery.isError");
    expect(gaiaView).toContain("overviewQuery.refetch()");
    expect(gaiaView).toContain("<QueryErrorState");
  });

  it("keeps the note editor's dedicated retry and return-to-notes actions", () => {
    expect(gaiaEditor).toContain("noteQuery.isError || !serverNote");
    expect(gaiaEditor).toContain("noteQuery.refetch()");
    expect(gaiaEditor).toContain("onClose");
  });
});

describe("Gaïa in-page navigation", () => {
  it("uses synchronous shallow history updates for tab and note navigation", () => {
    const router = readFileSync(
      new URL("../../src/lib/router.ts", import.meta.url),
      "utf8"
    );
    expect(router).toContain("export function navigateShallow");
    expect(router).toContain('window.history.pushState(null, "", target)');
    expect(router).toContain("window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT))");
    expect(gaiaView).toContain("import { navigateShallow, useRoute }");
    expect(gaiaView).toContain("navigateShallow(`/gaia");
    expect(gaiaView).not.toContain("navigate(`/gaia");
  });
});
