# End-to-end tests — gap and plan

## Current state: no browser E2E harness

There is no Playwright, Cypress or other browser harness in the repo:
no `tests/e2e`, no E2E dependency in `package.json`, no E2E job in CI.
(The word "playwright" appears in `bun.lock` only as a peer-dependency
mention inside the `next` and `vitest` package metadata — nothing is
installed.)

This was **not** added in lot 16, deliberately:

- A harness needs a new devDependency (`@playwright/test`) plus a
  regenerated `bun.lock`, plus browser binaries in CI
  (`playwright install --with-deps chromium`). The lockfile change cannot
  be produced or verified from this environment, and the CI change lives
  in `.github/workflows/ci.yml`, which only the user can push (the Muse
  GitHub App has no `workflows` permission). Shipping an E2E setup that
  no one has ever run would be worse than documenting the gap.
- The 10 critical journeys below are already covered at the route and
  server level by integration tests. What is missing is the browser layer
  (real rendering, real navigation, real cookies across pages).

## The 10 journeys and their current coverage

| # | Journey | Covered by (integration, route/server level) |
|---|---|---|
| 1 | Signup / login / logout | `tests/integration/auth-signup-route.test.ts` (route), `tests/integration/session-lifecycle.test.ts` |
| 2 | Trading account create / modify | `tests/integration/accounts-routes.test.ts` (route) |
| 3 | Trade BUY and SELL | `tests/integration/trades-grid-stats.test.ts`, `tests/integration/sync-engine.test.ts` |
| 4 | Risk, volume, P&L, R-Multiple | `tests/unit/*` (trading engine, lot 1) + `tests/integration/weekly-plan-performance.test.ts` |
| 5 | Broker import / sync + dedup | `tests/integration/sync-idempotence.test.ts`, `tests/integration/sync-engine.test.ts`, `tests/integration/import-reconciliation.test.ts` |
| 6 | Journal entry create + soft delete | `tests/integration/journal-deleted.test.ts`, `tests/integration/journal-isolation.test.ts` |
| 7 | Prop Firm challenge + evaluation | `tests/integration/prop-evaluation.test.ts` |
| 8 | Monte Carlo create + consult | `tests/integration/monte-carlo-runs.test.ts` |
| 9 | Share-link access + revocation | `tests/integration/sharing-flow.test.ts` |
| 10 | Data export + account deletion | `tests/integration/account-portability.test.ts` |

("Accès mentor" from the roadmap §21 is gone — the Mentors module was
removed on user decision, 25 Nov 2026. Journey 9 covers share-links
only.)

## Plan to add Playwright (for the user or a later lot)

1. Install: `bun add -d @playwright/test` (regenerates `bun.lock`),
   then `bunx playwright install --with-deps chromium`.
2. Add `playwright.config.ts` at the repo root: `testDir: "tests/e2e"`,
   headless Chromium, `webServer` starting `bun run dev -p 3100` with
   `TEST_DATABASE_URL` / `TEST_DIRECT_URL` pointed at the local
   `promethe_test` schema (same isolation as the integration suite),
   `reuseExistingServer: false`.
3. Add `tests/e2e/` specs for journeys 1, 2, 3 and 9 first (the most
   user-visible), then the rest.
4. Add a `test:e2e` script to `package.json` and a CI job that runs it
   after the existing quality job. The CI change must be pushed by the
   user — see the proposed workflow diff below.
5. Do not run E2E against Supabase or production: local Postgres +
   `promethe_test` schema only, same guard as `scripts/test-db.ts`.

## Proposed CI change (to be pushed by the user)

Add to `.github/workflows/ci.yml`, after the `quality` job (same
Postgres service, same env), a second job. Exact step to add inside a
new `e2e` job — migration validation belongs in the same job so a broken
migration fails CI before the browser tests run:

```yaml
  migrate-check:
    name: Validate Prisma migrations
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: promethe
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U test -d promethe"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Apply migrations on a disposable schema
        env:
          DATABASE_URL: postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check
          DIRECT_URL: postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check
        run: bunx prisma migrate deploy
      - name: Confirm migration status
        env:
          DATABASE_URL: postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check
          DIRECT_URL: postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check
        run: bunx prisma migrate status
```

This was validated locally on lot 16 against a disposable schema:
`migrate deploy` applied all 11 migrations (95 tables) and
`migrate status` reported "Database schema is up to date!". The schema
is disposable — it is created only for the check and dropped with the
CI runner. Once the Playwright harness exists, an `e2e` job with the
same Postgres service and a `bunx playwright install --with-deps
chromium` step can be added next to it.
