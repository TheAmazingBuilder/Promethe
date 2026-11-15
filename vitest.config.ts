import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test configuration — SEPARATE database (db/test.db, addendum §11.8): the
 * dev database (db/custom.db) is never touched by tests. The schema is
 * pushed by `bun run pretest` (scripts/test-db.ts) before vitest starts.
 */
export default defineConfig({
  test: {
    environment: "node",
    // .tsx needed for the Module 8 DOM leak tests (jsdom per-file pragma).
    include: ["tests/**/*.test.{ts,tsx}"],
    env: {
      DATABASE_URL: `file:${path.join(dirname, "db", "test.db")}`,
      // Deterministic test peppers (v3 §1) — never use production values.
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
