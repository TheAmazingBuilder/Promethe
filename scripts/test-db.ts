/**
 * Recreates the test database from scratch (db/test.db) — separate from the
 * dev database (db/custom.db), per addendum §11.8.
 * Runs `prisma db push` with DATABASE_URL overridden, after deleting any
 * previous test file so every run starts from a clean, deterministic state.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const testDb = path.join(root, "db", "test.db");

if (existsSync(testDb)) {
  rmSync(testDb);
}
// Prisma journal files for the test db (e.g. test.db-journal).
for (const extra of ["test.db-journal", "test.db-shm", "test.db-wal"]) {
  const p = path.join(root, "db", extra);
  if (existsSync(p)) rmSync(p);
}

execSync(
  "bunx prisma db push --skip-generate --accept-data-loss --schema prisma/schema.prisma",
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
