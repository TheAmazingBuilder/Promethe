/**
 * Lot 1 (MD §3.3) — the P&L simulator labels its two R values distinctly.
 *
 * "R multiple" unqualified used to mean the gross (price-only) R in the
 * simulator while the stored rMultiple is net-based. The simulator now
 * shows "R multiple (net)" (the stored convention, = realizedRR) and
 * "R multiple (gross)" (price-only, before costs), and no longer shows
 * a second "Realized R:R" row duplicating the net value.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messages = JSON.parse(
  readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")
) as Record<string, any>;
const simulator = readFileSync(
  new URL("../../src/components/tools/pnl-simulator.tsx", import.meta.url),
  "utf8"
);

describe("P&L simulator R labels (MD §3.3)", () => {
  it("has distinct net / gross R labels", () => {
    expect(messages.tools.rMultipleNet).toBe("R multiple (net)");
    expect(messages.tools.rMultipleGross).toBe("R multiple (gross)");
  });

  it("renders the net and gross R values, not a bare R multiple", () => {
    expect(simulator).toContain('t("rMultipleNet")');
    expect(simulator).toContain('t("rMultipleGross")');
    expect(simulator).toContain("preview.rMultiple");
    expect(simulator).toContain("preview.grossRMultiple");
    expect(simulator).not.toContain('t("rMultiple")');
    expect(simulator).not.toContain('t("realizedRR")');
  });
});
