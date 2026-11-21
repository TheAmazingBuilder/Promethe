import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/lib/import/index.ts", import.meta.url),
  "utf8"
);

describe("Import parser warning typing", () => {
  it("types warning collections with the shared import warning contract", () => {
    expect(source.match(/const warnings: ImportParseWarning\[\] = \[\];/g)).toHaveLength(2);
    expect(source).not.toMatch(/const warnings = \[\];/);
  });
});
