import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SCHEMA = "promethe_test";
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

const testDatabaseUrl = process.env.TEST_DATABASE_URL
  ? validateTestDatabaseUrl(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL")
  : FALLBACK_TEST_DATABASE_URL;

const testDirectUrl = process.env.TEST_DIRECT_URL
  ? validateTestDatabaseUrl(process.env.TEST_DIRECT_URL, "TEST_DIRECT_URL")
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
