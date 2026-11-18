# Promethe API

Versioned HTTP API for the Promethe trading journal. The current version is
**v1**. The version index is served at `GET /api/v1` (no auth, no database):
it returns the version, the auth schemes and the list of resources.

## Base URL

All calls are relative to the deployed app origin, for example
`https://app.example.com/api/v1/trades`. In local development the origin is
`http://localhost:3000`.

## Versioning rules

- `v1` is the current version. New clients must call `/api/v1/...`.
- Unversioned `/api/...` paths stay available as aliases during the
  transition. They run the exact same handlers as their `/api/v1/...`
  counterparts, so old clients keep working.
- Additive changes (new fields, new optional query parameters, new
  resources) ship inside `v1` and never break existing callers.
- A breaking change (removed field, changed semantics, new required
  parameter) ships as a new version (`v2`) with its own namespace. The old
  version keeps working until it is explicitly retired.
- The implementation of every route lives in `src/app/api/...`. The files
  under `src/app/api/v1/...` are thin re-exports of those handlers: edit
  the implementation file, never the re-export.

## Auth

Three schemes, depending on the endpoint family:

| Scheme | Used by | How it works |
| --- | --- | --- |
| Session cookie | All browser endpoints (`/api/v1/trades`, `/api/v1/gaia`, `/api/v1/analytics`, and so on) | The browser sends the session cookie set at sign-in. No token in the URL or in code. |
| Bearer `CRON_SECRET` | Cron endpoints (`/api/v1/cron/daily`, `/api/v1/cron/integrations`, and the unversioned `/api/cron/*` aliases) | `Authorization: Bearer $CRON_SECRET`. The secret must be at least 16 characters and set in `.env`, otherwise the endpoint answers 503. |
| Bearer broker token | Ingest endpoints (`/api/v1/ingest/mt`, `/api/v1/ingest/mt/ping`, and the unversioned `/api/ingest/mt*` aliases) | `Authorization: Bearer <token>`. The token is looked up by hash and is scoped to one broker connection, so a token can never write into another account. Payloads must be at most 10 minutes old and at most 1 MB. |

## Stable paths that stay unversioned

These callers hit fixed URLs that must never move, so they are documented
with their unversioned path even though a `/api/v1/...` alias also exists:

- **MT5/MT4 expert advisor**: `POST /api/ingest/mt` and
  `GET /api/ingest/mt/ping`. The endpoint URL is shown in the app under
  Broker Sync and is baked into the EA running on user terminals.
- **Cron / scheduler**: `POST /api/cron/daily` and
  `POST /api/cron/integrations` (Vercel Cron or any external scheduler).
- **Google OAuth flow**: `GET /api/auth/google` and
  `GET /api/auth/google/callback`. The callback URL is registered in the
  Google Cloud OAuth client and is derived from the request origin, so it
  cannot move to `/api/v1/...` without re-registering it. There is no
  `/api/v1/auth/google*` route on purpose.

## Resources

Top-level resources under `/api/v1/` (each maps to the same path under the
unversioned alias):

account, accounts, analytics, appearance, auth, broker-sync, calendar,
charts, comments, cron, custom-fields, custom-metrics, dashboard,
dashboards, display-preferences, exit-plans, exposure-settings, fx-rates,
gaia, goals, history, import, ingest, instruments, integrations, journal,
legal, market-sessions, mentor, mentors, notifications, playbook, profile,
prop-status, public, reconciliation, reports, risk-reward, rules,
saved-views, search, setups, share-links, shortcuts, strategies,
table-columns, tags, templates, tool-scenarios, trades, trash, uploads,
user-templates.

Nested resources follow the same pattern, for example
`/api/v1/trades/[id]/comments`, `/api/v1/gaia/notes/[id]/versions/[versionId]`,
`/api/v1/playbook/rules/[id]` and `/api/v1/dashboards/[id]/widgets/[widgetId]`.

## Errors

Every endpoint answers errors with the same envelope:

```json
{ "error": "UNAUTHORIZED", "message": "Missing or invalid session." }
```

Common codes: `401` unauthenticated (or bad token), `403` forbidden,
`404` not found, `422` validation error (with `fieldErrors`),
`429` rate limited, `500` server error, `503` cron secret unset.

## Examples

```bash
# Version index (no auth)
curl https://app.example.com/api/v1

# List trades (session cookie from the browser)
curl https://app.example.com/api/v1/trades -H "Cookie: session=..."

# Daily maintenance (scheduler)
curl -X POST https://app.example.com/api/cron/daily \
  -H "Authorization: Bearer $CRON_SECRET"

# Broker ingest (expert advisor)
curl -X POST https://app.example.com/api/ingest/mt \
  -H "Authorization: Bearer <broker-token>" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion": 3, "events": []}'
```
