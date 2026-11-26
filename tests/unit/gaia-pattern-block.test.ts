import { searchSnippet, searchTextOfBlocks, textOfBlocks } from "@/lib/gaia/content";
import { describe, expect, it } from "vitest";
import { gaiaBlockInputSchema, normalizeBlocks, parseStoredBlocks } from "@/lib/gaia/content";
describe("Gaia pattern blocks", () => {
  it("accepts known pattern ids", () => expect(gaiaBlockInputSchema.safeParse({ id: "p1", type: "pattern", text: "", patternId: "doji" }).success).toBe(true));
  it("rejects missing or unknown ids with a single issue (no duplicate check)", () => { const missing = gaiaBlockInputSchema.safeParse({ id: "p1", type: "pattern", text: "" }); expect(missing.success).toBe(false); if (!missing.success) expect(missing.error.issues).toHaveLength(1); expect(gaiaBlockInputSchema.safeParse({ id: "p1", type: "pattern", text: "", patternId: "../../x" }).success).toBe(false); });
  it("round-trips stable ids", () => { const blocks = normalizeBlocks([{ id: "p1", type: "pattern", text: "", patternId: "doji" }]); expect(parseStoredBlocks(blocks)[0]?.patternId).toBe("doji"); });
  it("drops any image source smuggled into a pattern block", () => {
    const normalized = normalizeBlocks([
      { id: "p1", type: "pattern", text: "", patternId: "doji", src: "https://example.com/evil.png", alt: "x", caption: "y" },
    ]);
    expect(normalized[0]).not.toHaveProperty("src");
    expect(normalized[0]).not.toHaveProperty("alt");
    expect(normalized[0]).not.toHaveProperty("caption");
    expect(normalized[0]?.patternId).toBe("doji");
    const parsed = parseStoredBlocks([
      { id: "p1", type: "pattern", text: "", patternId: "doji", src: "data:image/png;base64,AAAA" },
    ]);
    expect(parsed[0]).not.toHaveProperty("src");
    expect(parsed[0]?.patternId).toBe("doji");
    // Non-pattern blocks keep their image source.
    expect(normalizeBlocks([{ id: "i1", type: "image", text: "", src: "https://example.com/a.png" }])[0]?.src).toBe("https://example.com/a.png");
  });
  it("drops corrupted stored patterns", () => expect(parseStoredBlocks([{ id: "p1", type: "pattern", text: "", patternId: "invalid" }])).toEqual([]));
});


describe("Gaia pattern search indexing", () => {
  it("indexes pattern names and aliases without changing visible note text", () => {
    const blocks = [
      { id: "pattern-1", type: "pattern" as const, text: "", patternId: "doji" },
    ];
    expect(searchTextOfBlocks(blocks).toLowerCase()).toContain("doji");
    expect(searchTextOfBlocks(blocks).toLowerCase()).toContain("indecision");
    expect(textOfBlocks(blocks)).toBe("");
  });

  it("indexes the pattern context and interpretation for descriptive searches", () => {
    const blocks = [
      { id: "pattern-2", type: "pattern" as const, text: "", patternId: "hammer" },
    ];
    const indexed = searchTextOfBlocks(blocks).toLowerCase();
    expect(indexed).toContain("hammer");
    expect(indexed).toContain("support");
    expect(indexed).toContain("selling pressure");
  });

  it("centers the snippet on a capitalized pattern query", () => {
    const blocks = [
      { id: "pattern-3", type: "pattern" as const, text: "", patternId: "doji" },
    ];
    expect(searchSnippet(blocks, "Doji")).toContain("Doji");
  });
});

describe("Gaia pattern template support", () => {
  it("includes a reusable candlestick study template with a stable pattern id", async () => {
    const { builtInTemplates } = await import("@/lib/gaia/templates");
    const template = builtInTemplates().find((item) => item.id === "tpl-candlestick-pattern");
    expect(template).toBeDefined();
    expect(template?.blocks.some((block) => block.type === "pattern" && block.patternId === "doji")).toBe(true);
  });
});
