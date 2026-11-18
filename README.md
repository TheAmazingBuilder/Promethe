<p align="center">
  <img src="public/brand/phoenix-1.png" alt="Promethe phoenix" width="120" />
</p>

<h1 align="center">Promethe</h1>

<p align="center"><strong>Rise from every trade.</strong></p>

<p align="center">
  A trading journal for XAUUSD &amp; forex traders. Log your trades, grade your setups,<br />
  and find out — with honest numbers — what actually works.
  <br />
  <a href="https://promethe-nine.vercel.app">Live app</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white" alt="Vercel" />
  <img src="https://img.shields.io/badge/Vitest-6E9F67?style=flat&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/License-MIT-10B981?style=flat" alt="License: MIT" />
</p>

---

## What it is

Promethe is a self-hostable web app to record trades, keep a strategy playbook, and analyse performance. It is built for discretionary traders — mainly XAUUSD (gold) and forex — with exact decimal math for pips, lots, R multiples and costs. No demo data, no fake stats: empty states stay honest until you have real trades.

## Features

**Journal**

- Log trades with instrument, direction, entry / stop / target, size, costs and screenshots
- Exact decimal P&amp;L, R multiples and break-even math (XAUUSD pip = 0.10 by default, configurable per instrument)
- Daily journal: pre-market plan, post-market review, mood / sleep / discipline scores
- MT5 / MT4 statement import and broker sync, with reconciliation

**Analytics**

- Dashboards with customisable widgets, equity curve and KPIs
- Weekly improvement plan — 100% rules-based over your own stats, no AI, with an honest "is your edge real?" check (expectancy, sample size, confidence interval)
- Confluences with hit rates, grades (A+ / A / B / C) and by-grade analytics
- When-you-trade (hour, weekday, session), top leaks, habits, performance report with verdict, goals with auto progress

**Playbook &amp; risk**

- Versioned setups with invalidation rules, checklists and compliance scoring
- Interactive Risk/Reward × win-rate table, required win rate, expectancy in $ and R, daily risk-budget gauge, discipline score

**Gaïa**

- A notes workspace (mini-Notion) with a block editor, versions, tags and links to trades and strategies — your knowledge base, separate from the daily journal

**Integrations**

- Discord / Telegram summaries and alerts (drawdown, prop-firm rules)
- PDF monthly reports, PWA, guided tour, public share links, mentor mode

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS + shadcn/ui · Prisma + Supabase (PostgreSQL) · scrypt auth with optional Google OAuth · Vitest

## Quick start

```bash
git clone https://github.com/TheAmazingBuilder/Promethe.git
cd Promethe
npm install
cp .env.example .env   # fill in your own values (see below)
npx prisma db push
npx prisma generate
npm run dev            # http://localhost:3000
```

Seed the reference data (37 instruments, 21 tags, plus a local demo account — idempotent, local use only):

```bash
bun prisma/seed.ts
```

Apply Row Level Security in Supabase (SQL Editor, `prisma/rls.sql`). It is defense-in-depth for the `anon` / `authenticated` roles; the app itself scopes every query by user.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Postgres, Transaction pooler (port 6543) |
| `DIRECT_URL` | Yes | Supabase Postgres, Session pooler (port 5432) |
| `TOKEN_PEPPER` | Yes | HMAC peppers for tokens, shares and invites (≥ 16 chars) |
| `IP_HASH_PEPPER` | Yes | Hashing pepper for rate limiting (≥ 16 chars) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Google sign-in (OAuth) |
| `CRON_SECRET` | Optional | Bearer token for `/api/cron/*` |
| `INTEGRATION_ENCRYPTION_KEY` | Optional | AES-256-GCM key for Discord / Telegram secrets |
| `NEXT_PUBLIC_APP_URL` | Optional | Public base URL of the app |

Generate peppers with `openssl rand -hex 32`. Never commit a real `.env` — this repo is public.

## Deployment

1. **Supabase** — create a project, copy the pooler URLs into `DATABASE_URL` / `DIRECT_URL`, run `npx prisma db push`, apply `prisma/rls.sql` in the SQL Editor.
2. **Vercel** — import the repo (Next.js preset), set the environment variables above, deploy. The build runs `prisma generate` before `next build`, so the Prisma client always matches the current schema.

Notes for the free tiers: a Supabase free project pauses after ~7 days of inactivity (expect a ~30 s cold start); the Vercel Hobby plan is for non-commercial use. Rate limiting is in-memory — fine for personal use, move to Upstash before opening the app to the public.

## Project structure

```
prisma/            # schema, seed, RLS policies
src/app/           # App Router pages + API routes (/api/v1/…)
src/lib/trading/   # pure calculation engine (no UI strings)
src/server/        # data access, always scoped by user
src/components/    # UI: shell, views, tools, Gaïa editor
tests/             # unit + integration (Vitest, ~1,000 tests)
docs/              # API reference (docs/API.md)
```

## Tests

```bash
npm test           # Vitest (recreates an isolated test DB first)
npm run lint       # ESLint
```

## License

MIT — see [LICENSE](LICENSE).
