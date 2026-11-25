/**
 * Lot 11 (roadmap §15) - Gaïa search ranking.
 *
 * Search used to be a plain substring match sorted by recency, with the
 * total capped at the page size. Ranking is now relevance-first: title
 * hits outrank tag hits, which outrank body hits; every query token must
 * match (AND); accents are folded.
 */
import { describe, expect, it } from "vitest";
import {
  foldSearchText,
  rankSearchNotes,
  scoreSearchNote,
  searchTokens,
  type SearchableNote,
} from "@/lib/gaia/search";

function note(partial: Partial<SearchableNote>): SearchableNote {
  return {
    title: "",
    tagNames: [],
    bodyText: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("foldSearchText / searchTokens", () => {
  it("folds accents and case", () => {
    expect(foldSearchText("Café RÉSUMÉ")).toBe("cafe resume");
    expect(searchTokens("Café  résumé!")).toEqual(["cafe", "resume"]);
  });

  it("drops empty tokens", () => {
    expect(searchTokens("  ")).toEqual([]);
    expect(searchTokens("a-b_c")).toEqual(["a", "b", "c"]);
  });
});

describe("scoreSearchNote", () => {
  it("scores a title hit above a tag hit above a body hit", () => {
    const titleHit = scoreSearchNote(
      note({ title: "Gold setup", bodyText: "nothing" }),
      ["gold"],
    );
    const tagHit = scoreSearchNote(
      note({ title: "Other", tagNames: ["gold"], bodyText: "nothing" }),
      ["gold"],
    );
    const bodyHit = scoreSearchNote(
      note({ title: "Other", bodyText: "gold is heavy" }),
      ["gold"],
    );
    expect(titleHit).toBeGreaterThan(tagHit);
    expect(tagHit).toBeGreaterThan(bodyHit);
    expect(bodyHit).toBeGreaterThan(0);
  });

  it("requires every token (AND): one missing token scores zero", () => {
    expect(
      scoreSearchNote(note({ title: "Gold setup" }), ["gold", "silver"]),
    ).toBe(0);
    expect(
      scoreSearchNote(note({ title: "Gold silver setup" }), ["gold", "silver"]),
    ).toBeGreaterThan(0);
  });

  it("matches accents: cafe finds café", () => {
    expect(
      scoreSearchNote(note({ title: "Café du matin" }), ["cafe"]),
    ).toBeGreaterThan(0);
  });

  it("scores zero for an empty query", () => {
    expect(scoreSearchNote(note({ title: "Gold" }), [])).toBe(0);
  });
});

describe("rankSearchNotes", () => {
  it("orders by relevance, then recency on ties", () => {
    const ranked = rankSearchNotes(
      [
        note({ title: "Old body", bodyText: "gold", updatedAt: "2026-01-01T00:00:00.000Z" }),
        note({ title: "Gold title", updatedAt: "2026-01-01T00:00:00.000Z" }),
        note({ title: "Newer body", bodyText: "gold", updatedAt: "2026-02-01T00:00:00.000Z" }),
        note({ title: "No match", bodyText: "silver" }),
      ],
      "gold",
    );
    expect(ranked.map((r) => r.title)).toEqual([
      "Gold title",
      "Newer body",
      "Old body",
    ]);
  });

  it("returns an empty list for an empty query", () => {
    expect(rankSearchNotes([note({ title: "Gold" })], "  ")).toEqual([]);
  });
});
