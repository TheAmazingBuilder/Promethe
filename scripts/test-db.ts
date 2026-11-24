/**
 * Recreates the test database from scratch — separate from the dev database,
 * per addendum §11.8. SQLite-era file (db/test.db): the schema is now
 * PostgreSQL (prisma/schema.prisma), so a `file:` URL is no longer a valid
 * test database.
 *
 * SAFETY GUARD: `prisma db push` uses DIRECT_URL for DDL. On a machine whose
 * .env points DIRECT_URL at the production Supabase database, the old script
 * ran `db push --accept-data-loss` against production on every `npm test`
 * (DATABASE_URL was overridden to a file: URL, DIRECT_URL was inherited
 * untouched). This script now only pushes to a local Postgres, and skips the
 * push — without failing `npm test` — otherwise: the suite runs against
 * mocks and does not need a live test database.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const testDb = path.join(root, "db", "test.db");

const directUrl = process.env.DIRECT_URL ?? "";
const isLocalPostgres =
  /^(postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/)/.test(
    directUrl
  );

if (!directUrl || !isLocalPostgres) {
  console.log(
    "Skipping test database push: DIRECT_URL is " +
      (directUrl
        ? "not a local Postgres — refusing to run `prisma db push` against a remote database."
        : "not set.") +
      " Tests run against mocks and do not need a live test database." +
      " To enable a real test DB, set DIRECT_URL to a local Postgres (e.g. postgresql://postgres:postgres@localhost:5432/promethe_test)."
  );
  process.exit(0);
}

if (existsSync(testDb)) {
  rmSync(testDb);
}
// Prisma journal files for the test db (e.g. test.db-journal).
for (const extra of ["test.db-journal", "test.db-shm", "test.db-wal"]) {
  const p = path.join(root, "db", extra);
  if (existsSync(p)) rmSync(p);
}

execSync(
  "bunx prisma db push --skip-generate --schema prisma/schema.prisma",
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `file:${testDb}`,
    },
  }
);

console.log(`Test database ready: ${testDb}`);
