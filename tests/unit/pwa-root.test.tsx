/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PwaRoot } from "@/components/pwa/pwa-root";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PwaRoot", () => {
  it("registers the service worker when the browser supports it", async () => {
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(<PwaRoot />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    });
  });

  it("announces offline and online transitions", () => {
    render(<PwaRoot />);

    fireEvent(window, new Event("offline"));
    expect(screen.getByRole("status").textContent).toContain("You are offline");

    fireEvent(window, new Event("online"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers installation only after the browser exposes an install prompt", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    let resolveChoice: (value: { outcome: "accepted"; platform: string }) => void =
      () => undefined;
    const userChoice = new Promise<{ outcome: "accepted"; platform: string }>(
      (resolve) => {
        resolveChoice = resolve;
      }
    );
    const installEvent = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
    };
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;

    render(<PwaRoot />);
    expect(screen.queryByRole("button", { name: "Install Promethe" })).toBeNull();

    window.dispatchEvent(installEvent);
    const installButton = await screen.findByRole("button", {
      name: "Install Promethe",
    });
    fireEvent.click(installButton);

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    resolveChoice({ outcome: "accepted", platform: "web" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install Promethe" })).toBeNull();
    });
  });

  it("hides the install action after the app is installed", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: typeof prompt;
      userChoice: Promise<{ outcome: "dismissed"; platform: string }>;
    };
    installEvent.prompt = prompt;
    installEvent.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });

    render(<PwaRoot />);
    window.dispatchEvent(installEvent);
    expect(await screen.findByRole("button", { name: "Install Promethe" })).toBeTruthy();

    fireEvent(window, new Event("appinstalled"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install Promethe" })).toBeNull();
    });
  });
});
