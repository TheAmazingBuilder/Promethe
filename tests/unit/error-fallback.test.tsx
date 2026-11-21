/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorFallback } from "@/components/app/error-fallback";

describe("ErrorFallback", () => {
  it("shows a safe recovery message without exposing technical details", () => {
    render(<ErrorFallback onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText(/saved data has not been changed/i)).toBeTruthy();
    expect(screen.queryByText(/stack trace|TypeError|undefined/i)).toBeNull();
  });

  it("calls the provided retry action", () => {
    const onRetry = vi.fn();
    render(<ErrorFallback onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
