/**
 * Minimal service worker for Promethe (PWA).
 *
 * Security policy:
 * - Cache only public, immutable/static assets.
 * - Never cache API responses or navigations: authenticated pages can contain
 *   private trading data and must never be replayed after logout/revocation.
 * - Web Push payloads are shown, never stored: the push handler decrypts
 *   the payload, shows the notification, and keeps nothing in the cache.
 * - Bump CACHE_NAME to purge caches created by older Promethe workers.
 */
const CACHE_NAME = "promethe-v2-private-safe";
const CACHE_PREFIX = "promethe-";
const PRECACHE = [
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-180.png",
  "/brand/phoenix-1.png",
  "/brand/phoenix-2.png",
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Promethe — Offline</title>
  <body>
    <main>
      <h1>You are offline</h1>
      <p>Reconnect to the internet to access your journal securely.</p>
    </main>
  </body>
</html>`;

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
        // Offline on first install: precache fails silently; static assets
        // are cached as they are successfully loaded on later visits.
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
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
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

  // API responses (including owner and public media proxies) are
  // network-only. Their Cache-Control headers additionally use no-store.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response.ok && response.type === "basic") {
                const copy = response.clone();
                void cache.put(request, copy).catch(() => {
                  // Cache storage is an optimization; never fail the request
                  // just because the browser refused to persist an asset.
                });
              }
              return response;
            })
            .catch((error) => {
              if (cached) return cached;
              throw error;
            });

          return cached ?? network;
        })
      )
    );
    return;
  }

  // Navigations are never persisted. The previous worker cached HTML pages,
  // including authenticated pages, and could replay private data offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          })
      )
    );
  }
});

// Web Push: show the notification, never store the payload.
// The payload is the encrypted { title, body, url } sent by the server;
// it is shown once and discarded. Clicking opens the deep link (or the
// dashboard when none was given), reusing an open tab when possible.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Promethe";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (new URL(client.url).pathname === url && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      })
  );
});
