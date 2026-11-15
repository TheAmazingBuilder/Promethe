/**
 * Enforcement test (v2.5 Module 8, §1 — single choke point rule).
 *
 * After this module, ALL monetary / sensitive display must go through the
 * shared choke points:
 *   - <Money /> / <Sensitive /> components (src/components/privacy/money.tsx)
 *   - useFormat() (src/lib/format/use-format.ts)
 *   - fmtMoney / fmtSignedMoney / fmtPct (src/lib/format.ts — privacy-aware)
 *   - balances/lots/account/broker via their scope flags
 *
 * This test fails when a file OUTSIDE the allowlist calls fmtMoney /
 * fmtSignedMoney / constructs an Intl currency format / builds money strings
 * by hand. The allowlist is a RATCHET: it lists the files not yet migrated
 * (Phase 2 migrates them and shrinks the list to the legit raw-value
 * consumers like the CSV data export) — no NEW file may be added.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(dirname, "..", "..", "src");

/**
 * Legitimate direct consumers — every entry needs a reason.
 *  - src/lib/format.ts : the choke point itself.
 *  - src/components/privacy/money.tsx : <Money/> (calls the choke point).
 *  - src/lib/format/use-format.ts : useFormat() (re-exports the choke point).
 *  - CSV/data exports : real values BY DESIGN (the user explicitly exports
 *    their own data; the UI warns when privacy mode is on).
 */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  "lib/format.ts",
  "lib/format/use-format.ts",
  "components/privacy/money.tsx",
]);

/**
 * RATCHET — legacy files not yet migrated. Phase 2 (v2.5 Module 8) migrated
 * every money call site to <Money/>/useFormat() — the list is now EMPTY and
 * must stay empty: no NEW file may call the forbidden functions.
 */
const RATCHET_ALLOWLIST: ReadonlyArray<string> = [];

/** The ratchet can only move DOWN from here. */
const RATCHET_MAX = 0;

const FORBIDDEN_CALLS = /\b(?:fmtMoney|fmtSignedMoney)\s*\(/g;
const FORBIDDEN_CURRENCY = /Intl\.NumberFormat\([^)]*currency\s*:/;

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

describe("single choke point — no direct money formatting (Module 8, §1)", () => {
  it("money display goes through <Money/>/useFormat()/fmtMoney only", () => {
    const violations: string[] = [];
    for (const file of collectFiles(srcRoot)) {
      const rel = path.relative(srcRoot, file).split(path.sep).join("/");
      if (ALWAYS_ALLOWED.has(rel) || RATCHET_ALLOWLIST.includes(rel)) continue;
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        const call = FORBIDDEN_CALLS.exec(line);
        if (call) {
          violations.push(`${rel}:${index + 1} → "${call[1]}(" (${line.trim().slice(0, 90)})`);
        }
        if (FORBIDDEN_CURRENCY.test(line)) {
          violations.push(`${rel}:${index + 1} → Intl currency format (${line.trim().slice(0, 90)})`);
        }
      });
    }
    expect(
      violations,
      `Direct money formatting found — render <Money/> or call useFormat() instead:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("the ratchet only shrinks (no new allowlist entries)", () => {
    expect(RATCHET_ALLOWLIST.length).toBeLessThanOrEqual(RATCHET_MAX);
  });

  it("every ratchet entry still exists on disk (no dead allowlist entries)", () => {
    const missing = RATCHET_ALLOWLIST.filter(
      (rel) => !statSync(path.join(srcRoot, rel), { throwIfNoEntry: false })
    );
    expect(missing, `Allowlist entries pointing at missing files: ${missing.join(", ")}`).toEqual([]);
  });
});
