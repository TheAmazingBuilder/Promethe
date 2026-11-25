/**
 * Lot 4 — prisma/rls.sql must cover every Prisma model table (no DB).
 *
 * The Supabase access script is the only thing standing between the
 * public PostgREST API (anon / authenticated roles) and the tables: it
 * disables RLS and revokes every privilege on each listed table, and a
 * trailing ALTER DEFAULT PRIVILEGES covers tables created later. A
 * table missing from the list keeps Supabase's default grants and stays
 * publicly reachable — exactly what the 24 Nov advisor alert flagged
 * (journal_period_reviews and journal_templates were missing).
 *
 * This test is the regression guard for that gap: it parses the schema
 * and the script and fails if any model table is unlisted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const rls = readFileSync(
  new URL("../../prisma/rls.sql", import.meta.url),
  "utf8",
);

function modelTables(): string[] {
  const tables: string[] = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const map = match[2].match(/@@map\("([^"]+)"\)/);
    tables.push(map ? map[1] : match[1]);
  }
  return tables.sort();
}

function listedTables(): string[] {
  const array = rls.split("ARRAY[")[1].split("]::text[]")[0];
  return [...array.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("prisma/rls.sql covers every Prisma model table", () => {
  it("lists every model table, no more, no less", () => {
    const models = modelTables();
    const listed = listedTables();
    expect(models.length).toBeGreaterThan(0);
    expect(listed).toEqual(models);
  });

  it("explicitly covers the two tables the 24 Nov alert exposed", () => {
    const listed = listedTables();
    expect(listed).toContain("journal_period_reviews");
    expect(listed).toContain("journal_templates");
  });

  it("states the covered table count honestly in its header", () => {
    const header = rls.match(/applies ONLY to the (\d+) tables/);
    expect(header).not.toBeNull();
    expect(Number(header![1])).toBe(listedTables().length);
  });

  it("revokes privileges from anon/authenticated, now and by default", () => {
    expect(rls).toContain("DISABLE ROW LEVEL SECURITY");
    expect(rls).not.toContain("ENABLE ROW LEVEL SECURITY");
    expect(rls).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated",
    );
    expect(rls).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public");
    expect(rls).toContain(
      "REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated",
    );
  });

  it("does not claim per-user RLS policies", () => {
    expect(rls).not.toMatch(/CREATE POLICY/i);
    expect(rls).toMatch(/NOT per-user PostgreSQL RLS/i);
  });
});
