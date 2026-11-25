/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import {
  LayoutSaveStatus,
  type LayoutSaveStatusValue,
} from "@/components/dashboard/layout-save-status";

afterEach(() => cleanup());

function renderStatus(status: LayoutSaveStatusValue) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LayoutSaveStatus status={status} />
    </NextIntlClientProvider>
  );
}

describe("LayoutSaveStatus (lot 12, roadmap §16)", () => {
  it("renders nothing when idle", () => {
    const { container } = renderStatus("idle");
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows Saving while a save is in flight", () => {
    renderStatus("saving");
    expect(screen.getByRole("status").textContent).toContain("Saving layout");
  });

  it("shows Saved after a save lands", () => {
    renderStatus("saved");
    expect(screen.getByRole("status").textContent).toContain("Layout saved");
  });

  it("shows Save failed when a save fails", () => {
    renderStatus("error");
    expect(screen.getByRole("status").textContent).toContain(
      "Layout save failed"
    );
  });
});
