import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationRoot = join(process.cwd(), "prisma", "migrations");
const initialDir = join(migrationRoot, "20261121000000_initial_baseline");
const sql = readFileSync(join(initialDir, "migration.sql"), "utf8");
const lock = readFileSync(join(migrationRoot, "migration_lock.toml"), "utf8");

describe("versioned Prisma baseline", () => {
  it("uses a timestamped PostgreSQL migration directory", () => {
    expect(readdirSync(migrationRoot)).toContain("20261121000000_initial_baseline");
    expect(lock.trim()).toBe('provider = "postgresql"');
  });

  it("contains the complete initial schema without destructive statements", () => {
    expect((sql.match(/^CREATE TABLE /gm) ?? []).length).toBe(96);
    expect((sql.match(/^CREATE INDEX /gm) ?? []).length).toBeGreaterThan(100);
    expect((sql.match(/^ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY/gm) ?? []).length).toBeGreaterThan(100);
    expect(sql).not.toMatch(/^DROP (TABLE|INDEX|SCHEMA)|^TRUNCATE |^DELETE FROM /m);
    expect(sql).not.toContain("promethe_test");
  });
});
