import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Uniform page titles — every in-app view renders its title through the
 * shared PageHeader (text-2xl font-bold tracking-tight, description
 * text-sm text-muted-foreground). This test scans the source so a future
 * hand-written header in another size or weight fails loudly instead of
 * drifting the layout again. No test here touches the database.
 *
 * Deliberately out of scope (kept as-is, see below):
 * - auth-screen: logged-out hero title (text-3xl), outside the app shell.
 * - gaia-print: printed note headings are document content, not page titles.
 * - gaia-panels: small section headings inside the Gaïa overview tabs.
 * - gaia-blocks: note content heading sizes inside the block editor.
 * - KPI and figure text (tabular-nums) is data, not a page title.
 */

const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const EXCLUDED = [
  join(SRC, "components", "auth", "auth-screen.tsx"),
  join(SRC, "components", "gaia", "gaia-print.tsx"),
  join(SRC, "components", "gaia", "gaia-panels.tsx"),
  join(SRC, "components", "gaia", "gaia-blocks.tsx"),
];

describe("PageHeader — single title style", () => {
  it("defines the standard title and description classes once", () => {
    const source = readFileSync(
      join(SRC, "components", "ui", "page-header.tsx"),
      "utf8"
    );
    expect(source).toContain("text-2xl font-bold tracking-tight");
    expect(source).toContain("text-sm text-muted-foreground");
    expect(source).not.toContain("text-3xl");
    expect(source).not.toContain("font-extrabold");
  });

  it("is used by every view that renders a page header", () => {
    const using = walk(SRC).filter((f) => {
      const source = readFileSync(f, "utf8");
      return (
        source.includes("PageHeader") &&
        source.includes('from "@/components/ui/page-header"')
      );
    });
    // PageHeader itself excluded; 35+ views must import it.
    expect(using.length).toBeGreaterThanOrEqual(35);
  });

  it("leaves no page title in another size or weight", () => {
    const offenders: string[] = [];
    const heading = /<h[12][^>]*className="([^"]*)"/g;
    for (const file of walk(SRC)) {
      if (EXCLUDED.includes(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(heading)) {
        const classes = match[1];
        const hasSize = /(^|\s)(text-lg|text-xl|text-3xl|font-extrabold|sm:text-3xl)(\s|$)/.test(
          classes
        );
        // text-sm / text-base section headings (e.g. legal article sections)
        // may stay semibold; a semibold title at page-title size may not.
        const hasSemiboldTitle =
          /(^|\s)font-semibold(\s|$)/.test(classes) &&
          /(^|\s)text-2xl(\s|$)/.test(classes);
        if (hasSize || hasSemiboldTitle) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
