/**
 * Lot 15 (roadmap section 19) - CSRF posture of the cookie session.
 *
 * Promethe has no middleware and no Origin/Referer check: the CSRF defense
 * is the session cookie itself (SameSite=Lax, httpOnly, Secure in
 * production) PLUS the rule that no authenticated GET route mutates state.
 * A cross-site POST never carries the cookie; a cross-site top-level
 * navigation GET does, so every state-changing endpoint must be POST
 * (the full account export is POST for exactly this reason) and the only
 * state-changing GET left is the Google OAuth callback, guarded by the
 * state parameter + PKCE.
 *
 * These are static source tests (same pattern as pwa-single-mount.test.ts
 * and the Lot 4 rls-coverage test): they lock the posture without booting
 * the app. If a future route breaks the rule, this test fails first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const API_DIR = join(SRC_DIR, "app", "api");

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTs(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Body of every `export async function GET` in one route file. */
function getHandlerBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /export async function GET\b([\s\S]*?)(?=\nexport async function |\Z)/g;
  for (const m of source.matchAll(re)) bodies.push(m[1]);
  return bodies;
}

// Any of these inside a GET handler means the GET mutates server state.
const MUTATION_MARKERS = [
  /\.create\(/,
  /\.createMany\(/,
  /\.update\(/,
  /\.updateMany\(/,
  /\.delete\(/,
  /\.deleteMany\(/,
  /\.upsert\(/,
  /\$transaction\(/,
  /\$executeRaw/,
  /createSession\(/,
  /destroySession\(/,
  /requestUserExport\(/,
  /scheduleAccountDeletion\(/,
  /revokeSession\(/,
  /notifyInApp\(/,
  /deleteUploadObjects\(/,
];

// The single allowed exception: the OAuth callback creates a session on
// GET, but only after validating the state parameter + PKCE verifier.
const GOOGLE_CALLBACK = join(API_DIR, "auth", "google", "callback", "route.ts");

describe("CSRF posture: no authenticated GET route mutates state", () => {
  it("no GET handler writes, deletes or creates a session (except the OAuth callback)", () => {
    const offenders: string[] = [];
    for (const file of walkTs(API_DIR)) {
      if (file.endsWith("route.ts")) {
        const source = readText(file);
        for (const body of getHandlerBodies(source)) {
          const hits = MUTATION_MARKERS.filter((m) => m.test(body));
          if (hits.length > 0 && file !== GOOGLE_CALLBACK) {
            offenders.push(`${file} (${hits.join(", ")})`);
          }
        }
      }
    }
    expect(offenders, "state-changing GET routes (must be POST)").toEqual([]);
  });

  it("the Google OAuth callback validates state + PKCE before creating a session", () => {
    const source = readText(GOOGLE_CALLBACK);
    expect(source).toContain("google_oauth_state");
    expect(source).toContain("constantTimeEqual");
    expect(source).toContain("createSession");
  });
});

describe("CSRF posture: session cookie attributes", () => {
  it("createSession sets httpOnly + SameSite=Lax + Secure-in-production + path + 30-day maxAge", () => {
    const source = readText(join(SRC_DIR, "server", "session.ts"));
    expect(source).toContain("httpOnly: true");
    expect(source).toContain('sameSite: "lax"');
    expect(source).toContain('secure: process.env.NODE_ENV === "production"');
    expect(source).toContain('path: "/"');
    expect(source).toContain("maxAge: SESSION_TTL_S");
    expect(source).toContain("const SESSION_TTL_S = 30 * 24 * 60 * 60");
  });
});

describe("CSRF posture: the full account export is POST, not GET", () => {
  it("the export route defines POST and no GET", () => {
    const source = readText(join(API_DIR, "account", "export", "route.ts"));
    expect(source).toContain("export async function POST()");
    expect(source).not.toContain("export async function GET()");
  });

  it("both UI download call sites POST (the v1 alias re-exports the handlers)", () => {
    for (const file of [
      join(SRC_DIR, "components", "profile", "profile-view.tsx"),
      join(SRC_DIR, "components", "settings", "account-settings-view.tsx"),
    ]) {
      expect(readText(file)).toContain(
        'fetch("/api/v1/account/export", { method: "POST" })'
      );
    }
    expect(readText(join(API_DIR, "v1", "account", "export", "route.ts"))).toContain(
      'export * from "../../../account/export/route"'
    );
  });
});
