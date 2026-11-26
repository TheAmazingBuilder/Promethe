/** @vitest-environment jsdom */
import * as React from "react";
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

/**
 * Dispatches an `online` event from a layout effect: after the child
 * rendered, before any passive effect (subscription) runs. Used to land a
 * publish in the window between first render and subscription.
 */
function PublishOnlineOnLayout({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => {
    window.dispatchEvent(new Event("online"));
  }, []);
  return <>{children}</>;
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

  it("recovers when a publish lands between first render and subscription", async () => {
    // Regression (production, 26 Nov 2026): the banner stayed forever
    // even though navigator.onLine was true and the 30 s / focus /
    // pageshow / visibilitychange resyncs all ran. Root cause: the
    // component's isOnline was a snapshot taken by the useState
    // initializer at first render, updated only through the subscription.
    // A publish that landed between the first render and the subscription
    // effect flipped the module to online while the component still held
    // offline - and every later resync was a no-op, because publishOnline
    // only notifies on a change. The module and the component had diverged
    // permanently. useSyncExternalStore plus the immediate callback on
    // subscribe make the stuck state impossible.
    vi.useFakeTimers();
    setOnLine(false);
    vi.resetModules();
    const { PwaRoot: FreshPwaRoot } = await import("@/components/pwa/pwa-root");

    const renderFresh = (publishDuringCommit: boolean) => {
      const inner = (
        <NextIntlClientProvider locale="en" messages={messages}>
          <FreshPwaRoot />
        </NextIntlClientProvider>
      );
      return render(
        publishDuringCommit ? (
          <PublishOnlineOnLayout>{inner}</PublishOnlineOnLayout>
        ) : (
          inner
        ),
      );
    };

    // First mount attaches the window listeners; unmount it while leaving
    // its `online` listener attached: a stale listener from a previous
    // mount, as happens on a bfcache edge, a root teardown, or a remount
    // race.
    const first = renderFresh(false);
    expect(screen.getByRole("status").textContent).toContain("You are offline");
    const realRemove = window.removeEventListener.bind(window);
    const removeSpy = vi.spyOn(window, "removeEventListener");
    removeSpy.mockImplementation((type: string, ...args: unknown[]) => {
      if (type === "online") return;
      (realRemove as (...a: unknown[]) => void)(type, ...args);
    });
    first.unmount();
    cleanup();
    removeSpy.mockRestore();

    // Browser is online now, but the module state is still offline.
    setOnLine(true);

    // Second mount: its first render reads onlineState=false, then the
    // layout effect dispatches `online` and the stale listener publishes
    // true BEFORE the new mount subscribes.
    renderFresh(true);

    // The exact reported scenario: mount, 35 s, focus, pageshow,
    // visibilitychange - the banner must be gone, the browser is online.
    act(() => {
      vi.advanceTimersByTime(35_000);
    });
    fireEvent(window, new Event("focus"));
    fireEvent(window, new Event("pageshow"));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
