// @vitest-environment jsdom
/**
 * DateField + CalendarPopup behaviour: the popup opens on trigger click,
 * shows the reference month, commits a day click, supports the Now button
 * and month navigation, and closes on Escape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DateField } from "@/components/ui/date-field";

afterEach(() => cleanup());

function renderField(props: {
  value?: string;
  type?: "date" | "datetime-local";
  min?: string;
  max?: string;
  onChange?: (v: string) => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <I18nProvider>
      <DateField
        id="test-date"
        value={props.value ?? "2026-11-02"}
        type={props.type ?? "date"}
        min={props.min}
        max={props.max}
        onChange={onChange}
      />
    </I18nProvider>,
  );
  return { ...utils, onChange };
}

describe("DateField popup", () => {
  it("opens the popup on trigger click and shows November 2026", () => {
    renderField({});
    expect(screen.queryByText("November 2026")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    // Weekday header, Monday first.
    for (const label of ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Adjacent-month days are present but dimmed (Oct 26 in the first row).
    expect(screen.getByRole("button", { name: /Monday, October 26, 2026/i })).toBeTruthy();
  });

  it("commits a day click and closes (date type)", () => {
    const onChange = vi.fn();
    renderField({ onChange });
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    fireEvent.click(screen.getByRole("button", { name: /Sunday, November 15, 2026/i }));
    expect(onChange).toHaveBeenCalledWith("2026-11-15");
    expect(screen.queryByText("November 2026")).toBeNull();
  });

  it("navigates months with the arrow buttons", () => {
    renderField({});
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText("December 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByText("October 2026")).toBeTruthy();
  });

  it("keeps the time on day click and offers Now (datetime-local)", () => {
    const onChange = vi.fn();
    renderField({ value: "2026-11-02T09:30", type: "datetime-local", onChange });
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    expect(screen.getByLabelText("Time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sunday, November 15, 2026/i }));
    expect(onChange).toHaveBeenCalledWith("2026-11-15T09:30");
    // Datetime stays open so the time can be adjusted.
    expect(screen.getByText("November 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Now$/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    );
    expect(screen.queryByText("November 2026")).toBeNull();
  });

  it("closes on Escape", () => {
    renderField({});
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("November 2026")).toBeNull();
  });

  it("closes on outside click", () => {
    renderField({});
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("November 2026")).toBeNull();
  });

  it("disables days outside min/max", () => {
    renderField({ min: "2026-11-10", max: "2026-11-20" });
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    expect(
      screen.getByRole("button", { name: /Monday, November 2, 2026/i }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /Tuesday, November 10, 2026/i }),
    ).toHaveProperty("disabled", false);
  });

  it("moves focus with arrow keys", () => {
    renderField({});
    fireEvent.click(screen.getByRole("button", { name: /Nov 2, 2026/i }));
    const day2 = screen.getByRole("button", {
      name: /Monday, November 2, 2026/i,
    });
    // Opening focuses the selected day.
    expect(document.activeElement).toBe(day2);
    fireEvent.keyDown(day2, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Tuesday, November 3, 2026/i }),
    );
  });

  it("clears the value with the clear button", () => {
    const onChange = vi.fn();
    renderField({ onChange });
    fireEvent.click(screen.getByRole("button", { name: /clear date/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows the placeholder when empty", () => {
    renderField({ value: "" });
    expect(screen.getByRole("button", { name: /select a date/i })).toBeTruthy();
  });
});
