# PWA - install, offline behavior and limits

Promethe is installable as a Progressive Web App: standalone display,
emerald theme, brand icons, an install prompt, an offline indicator and
a service worker. This page documents how it works and what it
deliberately does not do.

## Single mount point

`PwaRoot` (`src/components/pwa/pwa-root.tsx`) is mounted exactly once,
in the root layout (`src/app/layout.tsx`). It covers logged-out users
too, so the install prompt and the offline indicator work on the auth
screen as well as inside the app. Do not mount it anywhere else: a
second mount would register the service worker twice, attach a second
set of window listeners and render duplicate offline and install UI.

`PwaRoot` owns:

- Service worker registration: `navigator.serviceWorker.register("/sw.js", { scope: "/" })`, once per mount.
- Window listeners: `online`, `offline`, `beforeinstallprompt`,
  `appinstalled` - one listener each, removed on unmount.
- Offline banner: a small fixed notice while `navigator.onLine` is
  false.
- Install button: shown only after the browser fires
  `beforeinstallprompt`, hidden after install or dismissal.

## Service worker (`public/sw.js`)

Cache policy, by design:

- Static assets only: `/_next/static/`, `/brand/`, `/ea/`, favicon and
  app icons. Cache-first with a network refresh; a stale cached copy is
  served only when the network fails.
- API responses are network-only (`/api/` is never intercepted). Their
  `Cache-Control` headers additionally use `no-store`.
- Navigations are never persisted. A failed navigation returns a small
  built-in offline page ("Promethe - Offline") with status 503 and
  `Cache-Control: no-store`. Authenticated pages are never replayed
  offline, so private trading data cannot leak after logout or
  revocation.
- `CACHE_NAME` (`promethe-v2-private-safe`) is bumped to purge caches
  from an older worker. On activation the worker deletes obsolete
  `promethe-*` caches only - it never deletes caches owned by another
  app on the same origin.

Update flow: the browser checks for a new `sw.js` on navigation. The
new worker calls `skipWaiting()` on install and `clients.claim()` on
activation, so the update takes over without waiting for tabs to
close.

## Limits - what the PWA does not do

- No background sync and no offline write queue. Going offline does not
  queue trades, journal entries or any other write: the app shows the
  offline banner and live data is unavailable until the connection
  returns. An offline queue was considered and rejected for now - it
  would need conflict handling, expiry, encryption where relevant,
  permissions and controlled replay, plus a security design for cached
  private data.
- No push notifications. Install covers "Add to Home Screen" only.
- No private data in any cache. Trades, journal entries, accounts and
  API responses are never cached by the service worker.

## Localhost note - the Euforia offline page

On 17 Nov 2026 the offline screen showed "Euforia" instead of
"Promethe". The Promethe code cannot produce that: the offline page,
the manifest and the service worker contain no reference to Euforia
(the name appears only in code comments about the Euforia analysis).
The cause was the browser state on `localhost:3000`, a port shared
with the Euforia web app: its service worker was still controlling
the page. In production this cannot happen - the origin belongs to
Promethe only.

If a stale offline page reappears on localhost, clear it in the
browser: DevTools - Application - Service Workers - Unregister the
old worker for `localhost:3000`, then hard refresh. Promethe's worker
then takes over the scope.
