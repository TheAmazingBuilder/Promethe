# Economic calendar - sources, merge rule and alerts

Lot 10 (roadmap section 12). One table (`EconomicEvent`), three sources,
one row per real-world event. No figure is ever invented: a missing value
stays empty in the UI, and stale data is never shown as fresh.

## 1. Sources

| Source | What it provides | What it does NOT provide |
|---|---|---|
| FRED (St. Louis Fed, official) | Scheduled dates + actual values for US macro releases | Forecast, impact rating |
| ForexFactory (unofficial feed) | Schedule, forecast, previous value, impact, all currencies | Actual value |
| MANUAL (the user) | Whatever the user enters | - |

### FRED - free key required

1. Create a free key at https://fred.stlouisfed.org (sign up, then
   "API Keys"). Free, no card.
2. Set `FRED_API_KEY` in `.env` (local dev) and in Vercel
   (Production + Preview, Sensitive) for the deployed app.
3. Without a key the app works fine: FRED reports NOT_CONFIGURED in
   the Sources card and the other sources keep syncing. Never commit a
   key, never paste one in chat.

FRED publishes dates, not times: US releases are assumed at 08:30 ET,
the standard US release time. Only releases in the curated map
(`FRED_RELEASE_MAP` in `src/lib/economic-calendar/providers.ts`) are
kept; the rest of FRED's calendar (hundreds of releases) is dropped.

### ForexFactory - unofficial, no key

Feed: `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (the
feed ForexFactory itself publishes for its calendar widgets). No key,
no account, no SLA: it can change shape or go dark. The provider
validates every row and fails soft: a dead feed marks the source DOWN,
never crashes the sync, never blocks FRED or manual events, and never
stores a guess. The feed covers the current week only; stored rows are
kept after the week ends and go stale instead of disappearing.

### Manual events

Created from the calendar page (Add event). A manual event is
authoritative: a sync never overwrites or deletes it, and creating a
manual event for a release that already exists (same title, day and
currency) is refused with 409 EVENT_ALREADY_EXISTS.

## 2. Merge rule (one row per real-world event)

Rows are keyed by `dedupeKey`: `slug(title) | UTC date | currency`. The
currency (not the country) is the third component on purpose: FRED
reports the ISO country code (`US`) while ForexFactory's `country`
field holds the currency code (`USD`), so keying on the country would
split one real release into two rows. The title slug disambiguates
same-currency releases (e.g. `German CPI m/m` vs `French CPI m/m`).
FRED release names are mapped to canonical titles first (e.g. FRED
"Consumer Price Index" becomes "CPI m/m"), so a FRED event merges with
the same ForexFactory event instead of duplicating it. Per-field
precedence when two providers meet on one row:

- scheduledAt: the official FRED date wins when the sources disagree
  on the day; on the same day the ForexFactory instant wins because it
  carries the exact time (FRED's 08:30 ET is an assumption).
- actual: FRED wins (official series value). ForexFactory has none.
- forecast: ForexFactory wins (FRED has none).
- previous: FRED wins (official series), ForexFactory fills when absent.
- impact: ForexFactory wins (FRED rates nothing).
- `source` on the row is the highest-precedence contributing source
  (FRED over ForexFactory); `sourceMeta` (JSON) records every
  contributing source with its last update and external id.

## 3. Freshness and health

- Every event shows its source and last update time.
- An event not refreshed for over 7 days is badged Stale.
- Per-source health (`EconomicCalendarSyncState`): OK, STALE (no
  success for over 24 h), DOWN (last run failed), NOT_CONFIGURED
  (FRED without a key). MANUAL is always OK: local data needs no sync.
- Sync runs on demand (Refresh button, throttled to once per 5 min per
  source unless forced) and from the cron route
  `POST|GET /api/cron/economic-calendar` (Bearer CRON_SECRET, same guard
  as the other cron routes). A dead source never blocks the others.

## 4. Watchlist and pre-event alerts

`EventWatchlist` holds the user's preferences: currencies, categories,
minimum impact, alerts on/off, minutes before. Unrated events (null
impact, e.g. all FRED events) always pass the minimum-impact filter:
their importance is unknown, hiding them would drop real announcements.
They are badged "Unrated" in the UI.

Alerts are in-app only (notification center, type
ECONOMIC_EVENT_SOON, deduped 12 h per event). No email, no push: those
channels do not exist yet (see docs/notifications.md).

## 5. Trade links and market context

- Auto-link: when a trade is created, edited or closed, events within
  60 min before to 120 min after the entry are linked, with phase
  BEFORE / DURING (within 5 min) / AFTER. Best-effort, never fails the
  trade save.
- Manual link/unlink from the event detail or the trade detail page.
- The trade detail page shows the linked events plus the
  MarketContextSnapshot (ATR/regime at entry) when one exists. The
  snapshot is computed from candles when available; when it is not,
  the card says so instead of showing numbers.

## 6. What not to do

- Never seed or hardcode economic events in the app (test fixtures
  inside tests only).
- Never present a forecast as an actual, or a stale value as fresh.
- Never add a Finnhub integration for this calendar: its economic
  calendar endpoint requires a premium plan (about $3,500/month).
- Never call a provider from the browser: keys stay server-side, and
  the ForexFactory feed is fetched server-side too.
