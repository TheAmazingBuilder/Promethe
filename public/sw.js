/**
 * Minimal service worker for Promethe (PWA).
 *
 * - Precaches the app shell essentials (icons + brand images) on install.
 * - Cache-first for same-origin static assets (/_next/static, /brand, /ea,
 *   icons): fast repeat loads, works offline for the shell.
 * - Network-first for everything else (pages, /api): never serves stale
 *   data or an outdated app version. API responses are never cached.
 * - Old caches are purged on activate (bump CACHE_NAME to invalidate).
 */
const CACHE_NAME = "promethe-v1";
const PRECACHE = [
  "/",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-180.png",
  "/brand/phoenix-1.png",
  "/brand/phoenix-2.png",
];

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/ea/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/icon-180.png"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {
        // Offline on first install: precache fails silently, the app still
        // works online and retries caching on later visits.
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic or auth.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached ?? network;
      })
    );
    return;
  }

  // Pages: network first, fall back to the cached shell when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === "navigate") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/")))
  );
});
