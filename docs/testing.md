# Testing — reproducible commands

How to run every check locally, with the same setup CI uses. CI runs on
`main` and `Features-promethe` (push + pull request): TypeScript, ESLint,
unit tests, integration tests on an isolated PostgreSQL schema, then a
production build. Every step blocks the run — there is no
`continue-on-error` anywhere in `.github/workflows/ci.yml`.

## Requirements

- Bun 1.3.x (CI pins 1.3.14), Node 20+ for tooling that needs it.
- A local PostgreSQL 16 with a `test` role and a `promethe` database
  (CI uses the `postgres:16` service with the same credentials).
- No production credentials anywhere in this flow: the test scripts refuse
  any non-local database URL.

## Commands

```bash
bun run typecheck        # tsc --noEmit, must be 0 errors
bun run lint             # eslint ., must be 0 errors
bun run test:unit        # vitest run tests/unit
bun run test:integration # test-db.ts (push schema) + vitest run tests/integration
bun run test:all         # unit + integration
bun run build            # prisma generate + typecheck + next build (standalone)
```

`bun run test` is `vitest run tests/unit` with `pretest` running
`scripts/test-db.ts` first (the same script `test:integration` runs).

## The test database

Integration tests run against the isolated `promethe_test` schema on the
local Postgres — never `public`, never Supabase. `scripts/test-db.ts`
rebuilds that schema with `prisma db push` and refuses any URL that is
not a local Postgres (`localhost` / `127.0.0.1` / `[::1]`). It reads
`TEST_DIRECT_URL` first, then `DIRECT_URL`.

For a clean integration run, drop the schema first, then let the script
recreate it:

```bash
psql -h 127.0.0.1 -U test -d promethe -c "DROP SCHEMA promethe_test CASCADE;"
bun run test:integration
```

`vitest.config.ts` enforces the same isolation at the config level: both
test URLs must target the `promethe_test` schema, and a `DATABASE_URL` /
`DIRECT_URL` pointing at the same database schema as a test connection
refuses the run (local URLs are exempt — CI points them at the same local
Postgres on purpose).

## Migrations are validated separately

CI validates the schema (`prisma validate`) but does not apply the
migration chain — `test-db.ts` uses `db push`, which never creates a
`_prisma_migrations` history. A broken migration would only surface when
the user runs `migrate deploy` on their PC. Validate the chain on a
disposable local schema before pushing a migration:

```bash
psql -h 127.0.0.1 -U test -d promethe -c "CREATE SCHEMA promethe_migrate_check;"
DATABASE_URL="postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check" \
DIRECT_URL="postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_migrate_check" \
  bunx prisma migrate deploy
# expect: "All migrations have been successfully applied."
psql -h 127.0.0.1 -U test -d promethe -c "DROP SCHEMA promethe_migrate_check CASCADE;"
```

A CI step that runs exactly this against a disposable schema is proposed
in `docs/e2e.md` (workflow changes must be pushed by the user — the Muse
GitHub App has no `workflows` permission).

## Flakiness and execution order

- Integration tests run with `--no-file-parallelism`: files run one after
  another, tests inside a file run in order. Nothing in the suite depends
  on file execution order; every integration file cleans up the users it
  creates in `afterAll` (the one exception was fixed in lot 16:
  `account-portability.test.ts` used to leave its users behind, so a
  re-run of that file alone failed in `beforeAll` on the unique-email
  constraint).
- Unit tests run in parallel workers with mocked I/O. No `.skip`, no
  retry config anywhere in the suite.
- Expected error output in logs is normal: error-path tests intentionally
  trigger Prisma unique-constraint failures (duplicate-key `ERROR` lines
  for `users_email_key` and the outbox `dedupe_key`). They do not fail the
  run; the client logs them at error level because the query itself failed.
  Do not "fix" them by hiding Prisma error logging — that would hide real
  failures too.

## End-to-end tests

There is no browser E2E harness yet. See `docs/e2e.md` for the gap, the
current route-level coverage of the 10 critical journeys, and the exact
plan to add Playwright.
