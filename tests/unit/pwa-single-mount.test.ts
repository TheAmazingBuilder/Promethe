/**
 * Lot 8 (roadmap section 10) - PWA single mount and offline identity.
 *
 * The audit found PwaRoot mounted twice: once in the root layout and once
 * in the app shell (logged-in branch). Two instances meant two service
 * worker registrations, two sets of window listeners and two copies of
 * the offline banner and install button. The single mount point is the
 * root layout, which covers logged-out users too.
 *
 * These are static source tests (same pattern as pwa-cache.test.ts and
 * the Lot 4 rls-coverage test): they lock the render tree shape, the
 * single registration site and the offline page identity without
 * booting the whole app shell. Since §25.5 the connectivity listeners
 * live in the offline-queue hook, owned by the single PwaRoot mount;
 * the install listeners stay in PwaRoot itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTs(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("PWA single mount", () => {
  it("mounts PwaRoot exactly once, in the root layout", () => {
    const files = walkTs(SRC_DIR);
    const usages = files
      .map((file) => ({ file, count: countOccurrences(readText(file), "<PwaRoot") }))
      .filter(({ count }) => count > 0);

    expect(usages).toHaveLength(1);
    expect(usages[0].file).toContain("/src/app/layout.tsx");
    expect(usages[0].count).toBe(1);
  });

  it("does not mount PwaRoot in the app shell", () => {
    const appRoot = readText(join(SRC_DIR, "components/app/app-root.tsx"));
    expect(appRoot).not.toContain("<PwaRoot");
    expect(appRoot).not.toContain("@/components/pwa/pwa-root");
  });

  it("registers the service worker from exactly one call site", () => {
    const files = walkTs(SRC_DIR);
    const sites = files
      .map((file) => ({ file, count: countOccurrences(readText(file), "serviceWorker.register") }))
      .filter(({ count }) => count > 0);

    expect(sites).toHaveLength(1);
    expect(sites[0].file).toContain("/src/components/pwa/pwa-root.tsx");
    expect(sites[0].count).toBe(1);
  });

  it("listens to each PWA window event exactly once per mount", () => {
    // Since §25.5 the connectivity listeners live in the offline-queue
    // hook (owned by the single PwaRoot mount); the install listeners
    // stay in PwaRoot itself.
    const pwaRoot = readText(join(SRC_DIR, "components/pwa/pwa-root.tsx"));
    const queueHook = readText(join(SRC_DIR, "lib/offline/use-offline-queue.ts"));
    const owners: Array<[string, string[]]> = [
      [queueHook, ["online", "offline"]],
      [pwaRoot, ["beforeinstallprompt", "appinstalled"]],
    ];
    for (const [text, events] of owners) {
      for (const event of events) {
        // Whitespace-tolerant: one removeEventListener call spans two lines.
        const added = text.match(new RegExp(`addEventListener\\(\\s*"${event}"`, "g")) ?? [];
        const removed = text.match(new RegExp(`removeEventListener\\(\\s*"${event}"`, "g")) ?? [];
        expect(added).toHaveLength(1);
        expect(removed).toHaveLength(1);
      }
    }
  });

  it("registers the listener-owning queue hook exactly once, in PwaRoot", () => {
    // useOfflineQueueState (no listeners) may be used by the queue panel;
    // useOfflineQueue (the listeners) must have a single call site.
    // The hook file itself holds the definition, not a call site.
    const files = walkTs(SRC_DIR).filter(
      (file) => !file.endsWith("/lib/offline/use-offline-queue.ts"),
    );
    const sites = files
      .map((file) => ({
        file,
        count: countOccurrences(readText(file), "useOfflineQueue()"),
      }))
      .filter(({ count }) => count > 0);
    expect(sites).toHaveLength(1);
    expect(sites[0].file).toContain("/src/components/pwa/pwa-root.tsx");
    expect(sites[0].count).toBe(1);
  });
});

describe("PWA offline page identity", () => {
  it("serves a Promethe offline page, never Euforia", () => {
    const worker = readText(join(PUBLIC_DIR, "sw.js"));
    const offlineHtml = worker.match(/const OFFLINE_HTML = `([\s\S]*?)`;/)?.[1] ?? "";
    expect(offlineHtml.length).toBeGreaterThan(0);
    expect(offlineHtml).toContain("Promethe");
    expect(offlineHtml).not.toMatch(/euforia/i);
    expect(offlineHtml).toContain("You are offline");
  });

  it("shows Promethe - and only Promethe - on every PWA-visible surface", () => {
    const surfaces = [
      join(PUBLIC_DIR, "sw.js"),
      join(SRC_DIR, "app/manifest.ts"),
      join(SRC_DIR, "components/pwa/pwa-root.tsx"),
      join(SRC_DIR, "app/layout.tsx"),
    ];
    for (const surface of surfaces) {
      const text = readText(surface);
      expect(text).toContain("Promethe");
      expect(text).not.toMatch(/euforia/i);
    }
  });
});

describe("PWA service worker update", () => {
  it("activates the new worker immediately and claims clients", () => {
    const worker = readText(join(PUBLIC_DIR, "sw.js"));
    const installStart = worker.indexOf('self.addEventListener("install"');
    const activateStart = worker.indexOf('self.addEventListener("activate"');
    const installHandler = worker.slice(installStart, activateStart);
    const activateHandler = worker.slice(activateStart);

    expect(installHandler).toContain("self.skipWaiting()");
    expect(activateHandler).toContain("self.clients.claim()");
  });
});
