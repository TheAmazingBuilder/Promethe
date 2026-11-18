import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GET as v1Index } from "@/app/api/v1/route";

/**
 * Versioned API (/api/v1/) — the re-export layer and the frontend migration.
 *
 * The implementation of every route lives in src/app/api/... and each
 * src/app/api/v1/.../route.ts re-exports it, so the versioned surface and
 * the unversioned alias run the exact same handlers. This test guards the
 * layer: a new route without its v1 twin, or a frontend call that slips
 * back to an unversioned path, fails here. No test here touches the database.
 *
 * Deliberately unversioned (see docs/API.md): the Google OAuth flow
 * (/api/auth/google, /api/auth/google/callback) and the stable caller
 * paths shown to the MT5/MT4 EA (/api/ingest/mt) and to schedulers
 * (/api/cron/*). Those keep working on their unversioned path by design.
 */

const SRC = join(__dirname, "..", "..", "src");
const API = join(SRC, "app", "api");
const V1 = join(API, "v1");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("API v1 — re-export layer", () => {
  it("has one v1 re-export per unversioned route (except Google OAuth)", () => {
    const implRoutes = walk(API)
      .filter((f) => f.endsWith(`${join("", "route.ts")}`))
      .map((f) => f.slice(API.length + 1, -"/route.ts".length))
      .filter((rel) => rel !== "" && !rel.startsWith("v1"))
      .filter((rel) => rel !== "auth/google" && rel !== "auth/google/callback");
    expect(implRoutes.length).toBeGreaterThan(100);

    const missing: string[] = [];
    for (const rel of implRoutes) {
      const v1File = join(V1, rel, "route.ts");
      if (!existsSync(v1File)) {
        missing.push(rel);
        continue;
      }
      const source = readFileSync(v1File, "utf8");
      const depth = rel.split("/").length;
      const expected = `export * from "${"../".repeat(depth + 1)}${rel}/route";`;
      expect(source).toContain(expected);
    }
    expect(missing).toEqual([]);
  });

  it("serves the version index at GET /api/v1", async () => {
    const res = await v1Index();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      status: string;
      resources: string[];
    };
    expect(body.version).toBe("v1");
    expect(body.status).toBe("current");
    for (const resource of ["trades", "gaia", "playbook", "auth", "ingest", "cron"]) {
      expect(body.resources).toContain(resource);
    }
  });
});

describe("API v1 — frontend calls the versioned surface", () => {
  it("leaves no unversioned call-site string outside the allowlist", () => {
    const offenders: string[] = [];
    const quoted = /["`]\/api\/(?!v1\/)/g;
    for (const file of walk(SRC)) {
      if (file.startsWith(API)) continue; // implementation comments stay
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(quoted)) {
        const line = source.slice(0, match.index).split("\n").length;
        const snippet = source.split("\n")[line - 1].trim();
        // Allowlist: the Google sign-in link (OAuth flow is unversioned).
        if (
          file.endsWith("components/auth/auth-screen.tsx") &&
          snippet.includes('href="/api/auth/google"')
        ) {
          continue;
        }
        offenders.push(`${file}:${line}: ${snippet}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the stable caller paths on their unversioned URL", () => {
    const brokerView = readFileSync(
      join(SRC, "components", "broker-sync", "broker-sync-view.tsx"),
      "utf8"
    );
    expect(brokerView).toContain("${appUrl}/api/ingest/mt");
    const brokerSync = readFileSync(join(SRC, "server", "broker-sync.ts"), "utf8");
    expect(brokerSync).toContain("/api/ingest/mt");
    const googleStart = readFileSync(
      join(API, "auth", "google", "route.ts"),
      "utf8"
    );
    expect(googleStart).toContain('"/api/auth/google/callback"');
  });
});
