# Notifications - dedupe rule and channels

Promethe has two separate notification systems. Do not confuse them.

## 1. In-app center (`src/server/notifications.ts`)

The bell in the app header polls `GET /api/v1/notifications` every 60 s.
It shows the unread count and the 30 most recent in-app rows; clicking a
row marks it read and navigates to its deep link. `PATCH` marks one row
(`{ id }`) or all (`{ all: true }`) read. Rows live in `notification_logs`
with `channel = 'IN_APP'` and are pruned after 90 days by the daily cron.

### Dedupe rule (lot 9)

`notifyInApp()` creates at most one **unread** notification per dedupe key
inside the window:

- Key: `(userId, type, url, dedupeKey, channel = 'IN_APP')`.
  `url` is usually the deep link;
  `dedupeKey` is an optional extra segment for alerts that share
  `(type, url)` but concern different entities — today the broker
  connection id for `SYNC_STALE` / `SYNC_MISMATCH`. Null matches only
  null.
- Window: `dedupeWithinMs`, default 10 min. Per-type windows in use:
  `SYNC_STALE` 6 h, `SYNC_MISMATCH` 24 h,
  `DELETION_*` 0 (never deduped).
- **A notification that was already read never blocks a new one.**
  Only unread rows inside the window suppress.
- Simultaneous calls for the same key are serialized with a Postgres
  advisory lock (`pg_advisory_xact_lock`, keyed on the dedupe key) held
  for the check-then-insert transaction, so two identical events cannot
  both slip through the check.
- `notifyInApp()` never throws (best effort): a failure is logged and
  the notification is skipped.
- `notifyInApp()` returns the created row id (or null when deduped or
  failed). `notifyUser()` creates the in-app row, then fans the same
  alert out to Web Push for the user's subscribed devices (section 3);
  the push payload is the redacted title/body of the row, and the row id
  is the push outbox dedupe key. Only alerts that were actually created
  fan out: a deduped call sends nothing anywhere.
- Mark-read is scoped to `IN_APP`: `markNotificationRead()` and
  `markAllNotificationsRead()` only touch in-app rows, so a future
  PUSH/EMAIL attempt logged in the same table is never marked read here.
- Privacy: when `hideAmountsInNotifications` is on, amounts are redacted
  from the persisted title/body before the row is written.

## 2. External alerts - integrations outbox (Discord / Telegram)

Daily summaries, drawdown alerts (50/80/95 %) and prop alerts are sent
through the integrations outbox (`src/server/integrations/delivery.ts`,
`processOutbox` with claim locking, retries and backoff), driven by
per-endpoint subscriptions with quiet hours. They are NOT driven by
`notifyInApp()`. The profile "Notification Preferences" section manages
these endpoints and subscriptions, and states honestly that there is no
email channel.

## 3. Channels

### Web push (built)

VAPID sender with no new dependency: `src/lib/push/vapid.ts` (RFC 8292
ES256 JWT, P-256) and `src/lib/push/encrypt.ts` (RFC 8291 / RFC 8188
`aes128gcm`, ECDH + HKDF-SHA256 + AES-128-GCM, Node built-in `crypto`
only). Env vars: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (server) and
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client, inlined at build time, so a
redeploy is required after setting the keys). `GET /api/push/config`
reports availability; when the keys are missing the UI states honestly
that push is unavailable and offers no working toggle.

- Subscribe / unsubscribe: `POST` / `DELETE /api/push/subscribe`
  (payload validated: https endpoint, 65-byte p256dh, 16-byte auth),
  one row per device in `push_subscriptions` (upsert on endpoint,
  `lastSeenAt` refreshed on re-subscribe). Ownership enforced: a user
  manages only their own rows. An endpoint transfers to the latest
  subscriber, so pushes always go to the account signed in on that
  device.
- Outbox: `push_outbox` table (`PushOutbox`, migration
  `20261126073000_push_outbox`), drained by `processPushOutbox()` from
  the same cron that drains the integrations outbox
  (`POST /api/cron/integrations`, Bearer `CRON_SECRET`). Same pattern
  as the integrations outbox: compare-and-set claims, 2-minute lease,
  max 5 attempts, exponential backoff (`2^attempts` min, capped at
  60), `Retry-After` honored, DEAD after exhaustion, per-user rate
  limit 30/min. A missing VAPID config defers the whole queue (no
  attempts consumed) instead of burning rows on an ops problem.
- Per-attempt logging: one `NotificationLog` row with `channel =
  'PUSH'` per attempt (`SENT` / `FAILED` / `SKIPPED`), reusing the
  in-app row id as dedupe key and the already-redacted title/body.
  The in-app center only lists `IN_APP` rows, so push attempts never
  appear in the bell.
- Expired subscriptions: a 410/404 from the push service deletes the
  subscription row and the queued row goes DEAD.
- Service worker: `public/sw.js` has a `push` handler (shows
  title/body, click opens the deep link) and a `notificationclick`
  handler. Payloads are shown once and never cached.
- UI: `PushNotificationsSection` in the profile Notification
  Preferences tab (default OFF, per device). A test button sends one
  real push to the device (`POST /api/push/test`).
- Fan-out (`notifyUser()`): SYNC_STALE, SYNC_MISMATCH,
  ECONOMIC_EVENT_SOON, DELETION_SCHEDULED, DELETION_CANCELLED.
  DAILY_SUMMARY, DRAWDOWN_ALERT and PROP_ALERT are NOT fanned out:
  they live in the integrations outbox with their own per-endpoint
  subscriptions and quiet hours (Discord / Telegram).

### Email (not built - design)

Not implemented. No Resend/SMTP sender, no email fan-out in
`notifyUser()`.
To build it: a Resend account, `RESEND_API_KEY` in the environment,
a verified sender domain, an explicit per-user opt-in (consent), and a
`channel = 'EMAIL'` write in `NotificationLog` per attempt
(`SENT` / `FAILED` / `SKIPPED`). Reuse the dedupe key and the
amount-redaction from section 1. Send through the integrations outbox
pattern (claim, retry with backoff, dead after N attempts) rather than
inline, so a provider outage never blocks the request. Never send
amounts when the user hid them; never send another user's data.

### Reminders (`reminder_settings`)

Dormant model. The table exists (`EVENING_JOURNAL`,
`UNREVIEWED_TRADES`, `WEEKLY_REPORT_READY`, `MONTHLY_REPORT_READY`,
`PROP_DRAWDOWN_ALERT`, `NEWS_UPCOMING`; per-type `channel`
`PUSH | EMAIL | BOTH`, local time, days of week, timezone, quiet
hours, `lastSentAt`) but no code reads or writes it: no evaluation
cron, no settings UI, no seed rows. Activating reminders requires a
channel first (email and/or push above) plus a cron evaluator that
respects timezone, quiet hours and `lastSentAt`, and a settings UI.
Do not wire it to the in-app center alone: a reminder the user never
opens the app to see is not a reminder.

## 4. What not to do

- Never invent notification counts, statuses or deliveries.
- Never send (or simulate sending) a notification containing another
  user's private data.
- Never cache private notification data in the service worker.
- Never add a new external channel silently: it needs a provider, a
  secret, and the user's consent first.
