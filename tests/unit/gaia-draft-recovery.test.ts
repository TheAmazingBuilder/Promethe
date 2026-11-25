/**
 * Lot 11 (roadmap §15) - Gaïa autosave recovery helpers.
 *
 * Pure parts: draft key, newer-than-server comparison, retry backoff
 * schedule. Storage access is guarded (private mode, SSR) and tested
 * here with a stubbed window.localStorage.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearLocalGaiaDraft,
  gaiaDraftKey,
  gaiaSaveRetryDelay,
  isLocalDraftNewer,
  loadLocalGaiaDraft,
  saveLocalGaiaDraft,
  type LocalGaiaDraft,
} from "@/lib/gaia/draft-recovery";

function makeDraft(partial: Partial<LocalGaiaDraft> = {}): LocalGaiaDraft {
  return {
    noteId: "note-1",
    title: "Title",
    icon: null,
    folderId: null,
    tagIds: [],
    favorite: false,
    blocksJson: JSON.stringify([{ id: "b1", type: "paragraph", text: "hi" }]),
    savedAtMs: 1_000,
    ...partial,
  };
}

describe("gaiaDraftKey", () => {
  it("keys the draft per note", () => {
    expect(gaiaDraftKey("abc")).toBe("promethe.gaia.draft.abc");
    expect(gaiaDraftKey("abc")).not.toBe(gaiaDraftKey("def"));
  });
});

describe("isLocalDraftNewer", () => {
  it("wins only when written strictly after the server update", () => {
    expect(
      isLocalDraftNewer(makeDraft({ savedAtMs: 2_000 }), "1970-01-01T00:00:01.000Z"),
    ).toBe(true);
    expect(
      isLocalDraftNewer(makeDraft({ savedAtMs: 1_000 }), "1970-01-01T00:00:01.000Z"),
    ).toBe(false);
    expect(
      isLocalDraftNewer(makeDraft({ savedAtMs: 1_000 }), "1970-01-01T00:00:02.000Z"),
    ).toBe(false);
  });

  it("wins when the server timestamp is unreadable", () => {
    expect(isLocalDraftNewer(makeDraft(), "not-a-date")).toBe(true);
  });
});

describe("gaiaSaveRetryDelay", () => {
  it("backs off 5s, 15s, 30s, then stops", () => {
    expect(gaiaSaveRetryDelay(0)).toBe(5_000);
    expect(gaiaSaveRetryDelay(1)).toBe(15_000);
    expect(gaiaSaveRetryDelay(2)).toBe(30_000);
    expect(gaiaSaveRetryDelay(3)).toBeNull();
    expect(gaiaSaveRetryDelay(-1)).toBeNull();
  });
});

describe("localStorage round-trip (stubbed window)", () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: fakeStorage,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("saves, loads and clears a draft", () => {
    const draft = makeDraft({ title: "Recover me" });
    saveLocalGaiaDraft(draft);
    expect(loadLocalGaiaDraft("note-1")).toEqual(draft);
    clearLocalGaiaDraft("note-1");
    expect(loadLocalGaiaDraft("note-1")).toBeNull();
  });

  it("ignores a draft stored under another note id", () => {
    saveLocalGaiaDraft(makeDraft({ noteId: "note-1" }));
    expect(loadLocalGaiaDraft("note-2")).toBeNull();
  });

  it("returns null for corrupted JSON instead of throwing", () => {
    store.set(gaiaDraftKey("note-1"), "{not json");
    expect(loadLocalGaiaDraft("note-1")).toBeNull();
  });

  it("returns null when localStorage is unavailable", () => {
    (globalThis as unknown as { window: unknown }).window = {};
    expect(loadLocalGaiaDraft("note-1")).toBeNull();
    // And saving never throws.
    expect(() => saveLocalGaiaDraft(makeDraft())).not.toThrow();
    expect(() => clearLocalGaiaDraft("note-1")).not.toThrow();
  });
});
