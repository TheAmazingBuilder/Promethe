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
email or push channel.

## 3. Channels NOT built - design

### Email

Not implemented. No Resend/SMTP sender, no `notifyUser()` fan-out.
To build it: a Resend account, `RESEND_API_KEY` in the environment,
a verified sender domain, an explicit per-user opt-in (consent), and a
`channel = 'EMAIL'` write in `NotificationLog` per attempt
(`SENT` / `FAILED` / `SKIPPED`). Reuse the dedupe key and the
amount-redaction from section 1. Send through the integrations outbox
pattern (claim, retry with backoff, dead after N attempts) rather than
inline, so a provider outage never blocks the request. Never send
amounts when the user hid them; never send another user's data.

### Web push

Not implemented. The `push_subscriptions` table exists (per-device VAPID
subscription, endpoint unique) but nothing reads or writes it: no
subscription API route, no VAPID keys, no `web-push` dependency, no
sender, no service-worker `push` handler.
To build it: VAPID key pair (`VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY`, the public key also served to the client),
a subscribe/unsubscribe API route storing one row per device,
a `push` event handler in `public/sw.js` showing the notification,
a `channel = 'PUSH'` write in `NotificationLog` per attempt, and an
explicit per-device opt-in. Expired subscriptions (410 Gone) must be
deleted. Same outbox pattern, same privacy rules as email.

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
