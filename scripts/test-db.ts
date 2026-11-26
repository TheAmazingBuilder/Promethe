/**
 * Recreates the test database from scratch — separate from the dev database,
 * per addendum §11.8. The test database is PostgreSQL
 * (prisma/schema.prisma); there is no SQLite test database anymore.
 *
 * SAFETY GUARD: `prisma db push` uses DIRECT_URL for DDL. On a machine whose
 * .env points DIRECT_URL at the production Supabase database, the old script
 * ran `db push --accept-data-loss` against production on every `npm test`.
 * This script only pushes to a local Postgres, and skips the push - without
 * failing `npm test` - otherwise: the suite runs against mocks and does not
 * need a live test database.
 *
 * The push target is TEST_DIRECT_URL when set, else DIRECT_URL. Both must
 * point at a local Postgres with `?schema=promethe_test` (see
 * vitest.config.ts, which enforces the same isolated schema).
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const directUrl =
  process.env.TEST_DIRECT_URL ?? process.env.DIRECT_URL ?? "";
const isLocalPostgres =
  /^(postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/)/.test(
    directUrl
  );

if (!directUrl || !isLocalPostgres) {
  console.log(
    "Skipping test database push: " +
      (directUrl
        ? "the push target is not a local Postgres - refusing to run `prisma db push` against a remote database."
        : "TEST_DIRECT_URL / DIRECT_URL is not set.") +
      " Tests run against mocks and do not need a live test database." +
      " To enable a real test DB, set TEST_DIRECT_URL to a local Postgres (e.g. postgresql://test:test@127.0.0.1:5432/promethe?schema=promethe_test)."
  );
  process.exit(0);
}

const schema = new URL(directUrl).searchParams.get("schema") ?? "(unknown)";

execSync(
  "bunx prisma db push --skip-generate --schema prisma/schema.prisma",
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DIRECT_URL: directUrl,
    },
  }
);

console.log(`Test database ready: local Postgres, schema "${schema}".`);
