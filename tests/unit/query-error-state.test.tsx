/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryErrorState } from "@/components/ui/query-error-state";

afterEach(() => cleanup());

describe("QueryErrorState", () => {
  it("announces the failure and explains the recovery action", () => {
    render(
      <QueryErrorState
        title="Calendar unavailable"
        description="Your entries are safe."
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Calendar unavailable" })).toBeTruthy();
    expect(screen.getByText("Your entries are safe.")).toBeTruthy();
  });

  it("invokes the retry callback", () => {
    const onRetry = vi.fn();
    render(<QueryErrorState onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
