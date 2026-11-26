# Prisma migrations

Promethe uses PostgreSQL and Prisma Migrate. Schema changes must be represented
by timestamped SQL migrations under `prisma/migrations/`; `prisma db push`
is not the deployment mechanism.

## Local development

1. Update `prisma/schema.prisma`.
2. Generate a migration against the isolated development database:

   ```bash
   bun run db:migrate
   ```

3. Review the generated SQL before committing it.
4. Run the full CI checks before moving to the next change.

Useful commands:

- `bun run db:migrate:status` — inspect migration history for the configured database.
- `bun run db:migrate:deploy` — apply committed migrations to a database whose migration history is already baselined.

## Existing Supabase database: important baseline rule

The existing Supabase `public` schema was previously provisioned without a
committed Prisma migration history. The initial migration in this repository is
a **baseline**, not a migration to blindly execute against that existing schema.

Before using `db:migrate:deploy` against Production:

1. Take a database backup.
2. Compare the live `public` schema with `prisma/schema.prisma` using
   `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`.
3. Resolve every difference. Do not mark the baseline as applied if the schema
   is not equivalent.
4. Only after a clean comparison, mark the baseline as already applied:

   ```bash
   bunx prisma migrate resolve --applied 20261121000000_initial_baseline
   ```

5. Confirm migration status, then use `bun run db:migrate:deploy` for future
   migrations.

Do not run `migrate deploy` against the existing Production `public` schema
before this baseline procedure. Never point destructive tests or reset scripts
at `public`.

## Test isolation

Automated database tests must use the dedicated `promethe_test` schema. They
must never fall back to `DATABASE_URL` or `DIRECT_URL` when the test-specific
variables are absent. The initial migration SQL is schema-neutral: Prisma's
connection URL determines the active schema when the migration is applied.
