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
  false. When queued changes exist it shows their count, a Retry
  button and a View queue button.
- Install button: shown only after the browser fires
  `beforeinstallprompt`, hidden after install or dismissal.
- Offline queue state (`src/lib/offline/use-offline-queue.ts`): live
  queue items, replay on reconnect, Background Sync registration.

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

## Web Push

Push notifications are implemented (§25.4, `docs/notifications.md`):
VAPID keys, per-device subscriptions, the `push` handler in `sw.js`
shows the notification and never stores the payload. The queue below
is unrelated to push delivery.

## Offline write queue (§25.5)

Going offline no longer loses work. Writes made while offline are
queued on the device and replayed when the connection returns.

### What is queued (V1)

- Create a trade offline (new trades only).
- Create and edit journal entries offline (one entry per day).
- Create and edit Gaïa notes offline (including notes created offline,
  which open in the editor on a provisional id until the create
  replays).

Not queued in V1: editing or deleting existing trades offline, bulk
import offline, screenshot/file upload offline.

### Storage and privacy

- The queue lives in IndexedDB (`promethe-offline` database), per user,
  on the device only. It is never in the service worker cache, never
  in any HTTP cache, and never synced across devices.
- The queue is cleared on logout, and on account switch. Replay uses
  the existing session auth (`requireUser`); every replayed operation
  is ownership-checked server-side exactly like the online path.
- Reference data only: the minimal per-user lists the offline forms
  need (accounts, strategies, instruments, tags, Gaïa folders and
  tags) are cached in IndexedDB while online and read back offline.
  Trade rows, journal content and note bodies are never cached for
  reading - writes only, plus the reference data the forms need.

### Idempotency

Every queued operation carries a client-generated idempotency key and
replays against the same API route the online path uses, with the same
server validation:

- Trades: `clientMutationId` (v2 §4.2) - replaying the same key returns
  the stored trade, never a duplicate.
- Journal: the natural key (user, day) - the upsert is idempotent by
  construction.
- Notes: `clientMutationId` on `Note` (same pattern as trades, scoped
  per user with a composite unique) - replaying the same key returns
  the stored note.

Replaying twice produces exactly one row. A second enqueue of the same
operation (same trade, same journal day, same note) replaces the
pending payload instead of adding a second queue item, keeping the
earliest conflict base.

### Replay

Automatic on the `online` event and on app open while online, plus a
manual "Retry now" action (banner and queue panel), plus Background
Sync where the browser supports it: the service worker relays its
`sync` event to the open clients, which replay in-page (session auth
lives in the page, not in the worker). When no client is open, the
queue replays on the next app open instead.

- 2xx: sent. A replayed create the server already has is still sent,
  never a duplicate.
- 422 validation: failed with the server reason, never retried
  automatically - the payload will not become valid on its own.
- 409 conflict: conflicted, both versions kept, user chooses.
- Network error mid-pass: the pass stops, items stay pending with
  their attempts untouched, and the next `online` event retries.
- After 5 server attempts an item stays failed until the user retries
  it manually.

### Conflicts

A journal entry or Gaïa note edited both offline and online is never
silently overwritten:

- Journal upsert: the replay carries the `expectedUpdatedAt` the
  client last saw. When the server row changed since, the replay is a
  409 CONFLICT carrying the server entry. The queue item keeps both
  versions; the user chooses "Keep mine" (replays with force, using
  the server's updatedAt as the new base) or "Keep server version"
  (discards the queued change).
- Note update: same rule for content edits (title, blocks). A
  metadata-only patch (favorite, folder, icon, tags) touches no
  content field and applies without a base check.
- Note create and trade create cannot conflict (new rows, deduped by
  idempotency key).

A conflicted replay never burns a Gaïa version slot: the version
snapshot happens only when the edit actually applies.

### Expiry

Queued operations expire 7 days after their last update
(`OFFLINE_QUEUE_TTL_MS`). Expired items are shown as expired in the
queue panel and never replayed silently; the user discards them. Sent
items are pruned from the queue after 24 hours.

### Queue UI

The queue panel (`src/components/offline/offline-queue-panel.tsx`,
opened from the banner) lists every item with its status (pending,
sending, sent, conflicted, failed, expired), per-item retry and
discard, conflict resolution, "Retry all" and "Clear sent". The
offline banner shows the count of changes waiting to sync.

### Limits - what the PWA does not do

- No offline reads: trade rows, journal content and note bodies are
  never cached, so the app cannot show them while offline. Only the
  queued writes and the reference lists above are available offline.
- No private data in the service worker cache. Trades, journal
  entries, accounts and API responses are never cached by the service
  worker. Push payloads are shown once and discarded.

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
