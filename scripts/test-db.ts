/**
 * Prepares the dedicated PostgreSQL test schema before integration tests.
 *
 * Tests use the same Supabase project if desired, but only the isolated
 * "promethe_test" schema. The production "public" schema is never reset.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_SCHEMA = "promethe_test";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseTestUrl(value: string | undefined, name: string): URL {
  if (!value) {
    throw new Error(
      `${name} is required. Configure a PostgreSQL URL with schema=${TEST_SCHEMA}; refusing to run database tests.`
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use PostgreSQL. SQLite is not supported.`);
  }

  if (url.searchParams.get("schema") !== TEST_SCHEMA) {
    throw new Error(
      `${name} must target schema=${TEST_SCHEMA}. Production/public schema is forbidden for tests.`
    );
  }

  return url;
}

const testDatabaseUrl = parseTestUrl(
  process.env.TEST_DATABASE_URL,
  "TEST_DATABASE_URL"
);
const testDirectUrl = parseTestUrl(
  process.env.TEST_DIRECT_URL,
  "TEST_DIRECT_URL"
);

for (const [name, productionValue] of [
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["DIRECT_URL", process.env.DIRECT_URL],
] as const) {
  if (!productionValue) continue;
  let productionUrl: URL;
  try {
    productionUrl = new URL(productionValue);
  } catch {
    continue;
  }

  const sameDatabase =
    productionUrl.hostname === testDatabaseUrl.hostname &&
    productionUrl.pathname === testDatabaseUrl.pathname;
  const sameSchema =
    productionUrl.searchParams.get("schema") ===
    testDatabaseUrl.searchParams.get("schema");

  if (sameDatabase && sameSchema) {
    throw new Error(
      `${name} points to the same database schema as TEST_DATABASE_URL. Refusing destructive test setup.`
    );
  }
}

if (
  testDatabaseUrl.hostname !== testDirectUrl.hostname ||
  testDatabaseUrl.pathname !== testDirectUrl.pathname ||
  testDirectUrl.searchParams.get("schema") !== TEST_SCHEMA
) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_DIRECT_URL must target the same PostgreSQL database and promethe_test schema."
  );
}

execFileSync(
  "bunx",
  [
    "prisma",
    "db",
    "push",
    "--skip-generate",
    "--force-reset",
    "--accept-data-loss",
    "--schema",
    "prisma/schema.prisma",
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl.toString(),
      DIRECT_URL: testDirectUrl.toString(),
    },
  }
);

console.log(`Test schema ready: ${TEST_SCHEMA}`);
