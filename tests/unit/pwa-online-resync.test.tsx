/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PwaRoot } from "@/components/pwa/pwa-root";
import messages from "../../messages/en.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function renderPwaRoot() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PwaRoot />
    </NextIntlClientProvider>,
  );
}

/**
 * Reproduce the stuck-banner state: the app is driven offline through the
 * real `offline` event, then the browser comes back online WITHOUT an
 * `online` event (transition missed: it fired before the listeners were
 * attached, on a bfcache restore, or the event stream and navigator.onLine
 * disagreed). The displayed state must recover by re-reading
 * navigator.onLine instead of waiting for an event that never comes.
 */
function showStuckOfflineBanner() {
  setOnLine(true);
  renderPwaRoot();
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent(window, new Event("offline"));
  expect(screen.getByRole("status").textContent).toContain("You are offline");

  // Browser back online, but no `online` event is delivered.
  setOnLine(true);
  expect(screen.getByRole("status").textContent).toContain("You are offline");
}

describe("PwaRoot online-state recovery", () => {
  it("recovers on window focus when the online event was missed", () => {
    showStuckOfflineBanner();

    fireEvent(window, new Event("focus"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recovers on visibilitychange when the online event was missed", () => {
    showStuckOfflineBanner();

    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recovers on pageshow (bfcache restore) when the online event was missed", () => {
    showStuckOfflineBanner();

    fireEvent(window, new Event("pageshow"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recovers on the periodic re-check when the online event was missed", () => {
    vi.useFakeTimers();
    showStuckOfflineBanner();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays offline when the browser is genuinely offline", () => {
    setOnLine(false);
    renderPwaRoot();
    expect(screen.getByRole("status").textContent).toContain("You are offline");

    fireEvent(window, new Event("focus"));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("status").textContent).toContain("You are offline");
  });
});
