# Google OAuth and Cron setup

This repository contains the Google OAuth routes and the two protected maintenance
endpoints. The code changes are committed, but external credentials and the Google
Cloud/Vercel dashboard settings must be completed by the project owner.

## 1. Google Cloud OAuth client

1. Open Google Cloud Console and select the project used by Promethe.
2. Configure the OAuth consent screen with the Promethe app name and contact email.
   During testing, add the Google accounts that should be allowed to sign in as test users.
3. Create an OAuth client ID with application type **Web application**.
4. Add the exact callback URI under **Authorized redirect URIs**:
   `https://YOUR_PRODUCTION_DOMAIN/api/auth/google/callback`
5. For local development, also authorize:
   `http://localhost:3000/api/auth/google/callback`

Google compares the callback URI exactly. Scheme, hostname, path, and trailing slash
must match the configured value.

## 2. Environment variables

Set these server-side variables in Vercel. Never expose the client secret as a
`NEXT_PUBLIC_*` variable and never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret from Google Cloud |
| `GOOGLE_REDIRECT_URI` | Exact callback URI authorized in Google Cloud |
| `CRON_SECRET` | Long random bearer secret used by scheduled jobs |

Set `GOOGLE_REDIRECT_URI` separately for each Vercel environment if the
environment uses a different stable hostname. Preview URLs that change per deployment
should not be used as permanent OAuth callback URLs; use a stable domain that is
registered in Google Cloud.

For local development, the code defaults to
`http://localhost:3000/api/auth/google/callback` when
`GOOGLE_REDIRECT_URI` is omitted. The Google Cloud client must still authorize
that localhost URI.

After adding or changing environment variables, redeploy the relevant Vercel
environment so the server functions receive them.

## 3. OAuth security behavior

The sign-in flow uses:

- a random, short-lived, HttpOnly `state` cookie to prevent CSRF;
- Authorization Code flow with PKCE S256;
- a fixed production callback URI from `GOOGLE_REDIRECT_URI`, rather than deriving
  it from the incoming request host;
- constant-time state comparison and cleanup of temporary OAuth cookies;
- an explicit `email_verified: true` requirement before linking a Google identity
  to a Promethe account.

## 4. Vercel Cron

The root `vercel.json` registers two daily schedules (UTC):

| UTC time | Endpoint | Purpose |
| --- | --- | --- |
| 10:00 | `/api/cron/daily` | Retention cleanup, due account deletions, rate-limit pruning and daily snapshots |
| 10:15 | `/api/cron/integrations` | Drain Discord/Telegram outbox and send due daily summaries |

Vercel Cron schedules defined in `vercel.json` are activated by a Production
deployment. They do not run automatically on Preview deployments.

Generate a strong secret locally, for example:

```bash
openssl rand -hex 32
```

Save the result as the Vercel Production environment variable `CRON_SECRET`.
Do not paste it into source files, commits, screenshots, or chat. The cron routes
reject missing/short secrets with HTTP 503 and invalid bearer tokens with HTTP 401.
Vercel sends the configured cron secret in the `Authorization: Bearer` header.

To test an endpoint manually after deployment, run this from a terminal where
`CRON_SECRET` is set:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_PRODUCTION_DOMAIN/api/cron/daily

curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_PRODUCTION_DOMAIN/api/cron/integrations
```

Both handlers also accept GET requests, matching Vercel Cron's invocation behavior.
