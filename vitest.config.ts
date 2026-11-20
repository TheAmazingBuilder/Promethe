import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SCHEMA = "promethe_test";

function readTestEnvFiles(): Record<string, string> {
  const values: Record<string, string> = {};
  const files = [".env", ".env.local", ".env.test", ".env.test.local"];

  for (const file of files) {
    const filePath = path.join(dirname, file);
    if (!existsSync(filePath)) continue;

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(TEST_DATABASE_URL|TEST_DIRECT_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      values[match[1]] = value;
    }
  }

  return values;
}
const fileTestEnv = readTestEnvFiles();
const FALLBACK_TEST_DATABASE_URL =
  "postgresql://invalid:invalid@127.0.0.1:1/promethe_test?schema=promethe_test";

function validateTestDatabaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use PostgreSQL; SQLite is not supported.`);
  }

  if (url.searchParams.get("schema") !== TEST_SCHEMA) {
    throw new Error(
      `${name} must target the isolated "${TEST_SCHEMA}" schema, never "public".`
    );
  }

  return value;
}

const configuredTestDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? fileTestEnv.TEST_DATABASE_URL;
const configuredTestDirectUrl =
  process.env.TEST_DIRECT_URL ?? fileTestEnv.TEST_DIRECT_URL;

const testDatabaseUrl = configuredTestDatabaseUrl
  ? validateTestDatabaseUrl(configuredTestDatabaseUrl, "TEST_DATABASE_URL")
  : FALLBACK_TEST_DATABASE_URL;

const testDirectUrl = configuredTestDirectUrl
  ? validateTestDatabaseUrl(configuredTestDirectUrl, "TEST_DIRECT_URL")
  : testDatabaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    // .tsx needed for the Module 8 DOM leak tests (jsdom per-file pragma).
    include: ["tests/**/*.test.{ts,tsx}"],
    env: {
      // Never fall back to DATABASE_URL: missing test configuration must fail
      // against an unreachable local URL rather than touching production.
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDirectUrl,
      TOKEN_PEPPER: "test-token-pepper-0123456789abcdef",
      IP_HASH_PEPPER: "test-ip-pepper-fedcba9876543210",
    },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
});
