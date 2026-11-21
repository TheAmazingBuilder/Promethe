/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("announces empty content politely and preserves module actions", () => {
    render(
      <EmptyState
        title={<p>No trades yet</p>}
        description={<p>Log your first trade to begin.</p>}
        actions={<button type="button">Create trade</button>}
      />
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("No trades yet")).toBeTruthy();
    expect(screen.getByText("Log your first trade to begin.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create trade" })).toBeTruthy();
  });

  it("supports a compact message without icon, description or action", () => {
    render(<EmptyState title={<p>No activity</p>} className="gap-0 py-0" />);

    expect(screen.getByRole("status").textContent).toContain("No activity");
  });
});
