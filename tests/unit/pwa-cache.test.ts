import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8"
);

describe("PWA private-data cache policy", () => {
  it("uses a new cache namespace to purge caches from the previous worker", () => {
    expect(serviceWorker).toContain('const CACHE_NAME = "promethe-v2-private-safe"');
    expect(serviceWorker).not.toContain('const CACHE_NAME = "promethe-v1"');
  });

  it("does not precache the authenticated application root", () => {
    const precache = serviceWorker.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "";
    expect(precache).not.toMatch(/["']\/["']/);
    expect(precache).toContain('"/favicon.ico"');
  });

  it("keeps API traffic network-only", () => {
    expect(serviceWorker).toContain('if (url.pathname.startsWith("/api/")) return;');
  });

  it("does not persist navigation responses or replay cached pages offline", () => {
    const navigationStart = serviceWorker.indexOf('if (request.mode === "navigate")');
    expect(navigationStart).toBeGreaterThan(-1);
    const navigationHandler = serviceWorker.slice(navigationStart);
    expect(navigationHandler).toContain('fetch(request, { cache: "no-store" })');
    expect(navigationHandler).toContain('new Response(OFFLINE_HTML');
    expect(navigationHandler).not.toContain("cache.put(");
    expect(navigationHandler).not.toContain("caches.match(request)");
  });
});
