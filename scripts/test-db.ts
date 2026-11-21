/**
 * Prepares the isolated PostgreSQL test schema before integration tests.
 * This is intentionally destructive, but only against schema "promethe_test".
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_SCHEMA = "promethe_test";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function projectRef(url: URL): string | null {
  const direct = url.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1];
  const pooled = url.username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1];
  return direct ?? pooled ?? null;
}

function sameDatabaseProject(left: URL, right: URL): boolean {
  const leftRef = projectRef(left);
  const rightRef = projectRef(right);
  if (leftRef && rightRef) return leftRef === rightRef;
  return left.hostname === right.hostname;
}

function readTestEnvFiles(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of [".env", ".env.local", ".env.test", ".env.test.local"]) {
    const filePath = path.join(ROOT, file);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\\r?\\n/)) {
      const match = line.match(/^\\s*(?:export\\s+)?(DATABASE_URL|DIRECT_URL|TEST_DATABASE_URL|TEST_DIRECT_URL)\\s*=\\s*(.*?)\\s*$/);
      if (!match) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\\s+#.*$/, "").trim();
      }
      values[match[1]] = value;
    }
  }
  return values;
}

const fileEnv = readTestEnvFiles();

function parseTestUrl(value: string | undefined, name: string): URL {
  if (!value) {
    throw new Error(`${name} is required. Configure a PostgreSQL URL with schema=${TEST_SCHEMA}; refusing to run database tests.`);
  }
  let url: URL;
  try { url = new URL(value); } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use PostgreSQL. SQLite is not supported.`);
  }
  if (url.searchParams.get("schema") !== TEST_SCHEMA) {
    throw new Error(`${name} must target schema=${TEST_SCHEMA}. Production/public schema is forbidden for tests.`);
  }
  return url;
}

const testDatabaseUrl = parseTestUrl(process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL, "TEST_DATABASE_URL");
const testDirectUrl = parseTestUrl(process.env.TEST_DIRECT_URL ?? fileEnv.TEST_DIRECT_URL, "TEST_DIRECT_URL");

if (
  testDatabaseUrl.pathname !== testDirectUrl.pathname ||
  testDatabaseUrl.searchParams.get("schema") !== testDirectUrl.searchParams.get("schema") ||
  !sameDatabaseProject(testDatabaseUrl, testDirectUrl)
) {
  throw new Error("TEST_DATABASE_URL and TEST_DIRECT_URL must target the same database and Supabase project, with schema=promethe_test.");
}

const productionUrls = [
  ["DATABASE_URL", process.env.DATABASE_URL ?? fileEnv.DATABASE_URL],
  ["DIRECT_URL", process.env.DIRECT_URL ?? fileEnv.DIRECT_URL],
] as const;
const testUrls = [testDatabaseUrl, testDirectUrl];

for (const [name, value] of productionUrls) {
  if (!value) continue;
  let productionUrl: URL;
  try { productionUrl = new URL(value); } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL; refusing destructive test setup.`);
  }
  for (const testUrl of testUrls) {
    const sameDatabase =
      productionUrl.pathname === testUrl.pathname &&
      productionUrl.searchParams.get("schema") === testUrl.searchParams.get("schema") &&
      sameDatabaseProject(productionUrl, testUrl);
    if (sameDatabase) {
      throw new Error(`${name} points to the same database schema as a test connection. Refusing destructive test setup.`);
    }
  }
}

execFileSync(
  "bunx",
  ["prisma", "db", "push", "--skip-generate", "--force-reset", "--accept-data-loss", "--schema", "prisma/schema.prisma"],
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

console.log(`Isolated test schema ready: ${TEST_SCHEMA}`);
