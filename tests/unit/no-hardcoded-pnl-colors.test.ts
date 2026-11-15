/**
 * Enforcement test (v2.5 Module 1, spec §1) — NO hard-coded gain/loss colors.
 *
 * P&L coloring must go through the semantic tokens (text-gain / text-loss /
 * bg-gain-subtle / … in globals.css) so palettes and the custom appearance
 * apply everywhere. This test fails when an emerald/green/rose/red/lime/pink
 * Tailwind utility sneaks back into the dashboard, analytics, calendar, trade
 * badge or formatting code.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(dirname, "..", "..", "src");

const SCOPES: string[] = [
  path.join(srcRoot, "components", "dashboard"),
  path.join(srcRoot, "components", "analytics"),
  path.join(srcRoot, "components", "calendar"),
  path.join(srcRoot, "components", "trades", "trade-bits.tsx"),
  path.join(srcRoot, "lib", "format.ts"),
];

/**
 * Explicit exceptions, as `"<relative file path>"` entries with a reason.
 * Every entry must justify why a literal P&L color is legitimate there.
 * Goal: keep this list EMPTY.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [];

const FORBIDDEN =
  /(?:text|bg|border)-(?:emerald|green|rose|red|lime|pink)-\d{2,3}/;

function collectFiles(target: string): string[] {
  const stats = statSync(target);
  if (stats.isFile()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target)) {
    const full = path.join(target, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no hard-coded P&L colors (appearance system, spec §1)", () => {
  it("dashboard/analytics/calendar/trade-bits/format use semantic tokens only", () => {
    const violations: string[] = [];

    for (const scope of SCOPES) {
      for (const file of collectFiles(scope)) {
        const rel = path.relative(srcRoot, file);
        const allowed = ALLOWLIST.some((entry) => entry.file === rel);
        if (allowed) continue;
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, index) => {
          const match = FORBIDDEN.exec(line);
          if (match) {
            violations.push(
              `${rel}:${index + 1} → "${match[0]}" (${line.trim().slice(0, 100)})`
            );
          }
        });
      }
    }

    expect(
      violations,
      `Hard-coded gain/loss colors found — use the semantic utilities instead:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("the allowlist stays empty (no permanent exceptions)", () => {
    expect(ALLOWLIST).toEqual([]);
  });
});
