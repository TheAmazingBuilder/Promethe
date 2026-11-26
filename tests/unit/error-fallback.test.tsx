/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());
import { ErrorFallback } from "@/components/app/error-fallback";

describe("ErrorFallback", () => {
  it("shows a safe recovery message without exposing technical details", () => {
    render(<ErrorFallback onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText(/check whether it was saved/i)).toBeTruthy();
    expect(screen.queryByText(/saved data has not been changed/i)).toBeNull();
    expect(screen.queryByText(/stack trace|TypeError|undefined/i)).toBeNull();
  });

  it("calls the provided retry action", () => {
    const onRetry = vi.fn();
    render(<ErrorFallback onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
