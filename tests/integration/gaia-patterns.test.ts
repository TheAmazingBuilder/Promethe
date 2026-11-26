/**
 * Gaia pattern blocks - integration: server persistence, validation,
 * duplication, templates, versions, search and isolation (PostgreSQL
 * schema promethe_test). Dossier §9.6.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createNote,
  duplicateNote,
  getNote,
  getVersion,
  instantiateTemplate,
  listVersions,
  restoreVersion,
  searchNotes,
  updateNote,
} from "@/server/gaia";

let userA: { id: string };
let userB: { id: string };

const patternBlock = (id: string, patternId: string) => ({
  id,
  type: "pattern",
  text: "",
  patternId,
});

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "gaia-patterns-a@test.local",
    password: "Test1234!test",
    displayName: "Gaia Patterns A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  const b = await createUserWithDefaults({
    email: "gaia-patterns-b@test.local",
    password: "Test1234!test",
    displayName: "Gaia Patterns B",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userB = b.user;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
});

describe("Gaia pattern persistence", () => {
  it("round-trips a pattern block through create and read, preserving id and order", async () => {
    const created = await createNote(userA.id, {
      title: "Doji study",
      blocks: [
        { id: "b1", type: "paragraph", text: "Before" },
        patternBlock("b2", "doji"),
        { id: "b3", type: "paragraph", text: "After" },
      ],
    });
    const read = await getNote(userA.id, created.note.id);
    expect(read.note.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(read.note.blocks[1]).toMatchObject({ type: "pattern", patternId: "doji" });
  });

  it("rejects an unknown pattern id at the server boundary", async () => {
    const created = await createNote(userA.id, {
      title: "Bad pattern",
      blocks: [{ id: "b1", type: "paragraph", text: "x" }],
    });
    await expect(
      updateNote(userA.id, created.note.id, {
        blocks: [patternBlock("b1", "not-a-pattern")],
      }),
    ).rejects.toThrow();
    // The note is unchanged after the rejected write.
    const read = await getNote(userA.id, created.note.id);
    expect(read.note.blocks).toHaveLength(1);
    expect(read.note.blocks[0].type).toBe("paragraph");
  });

  it("drops an image source smuggled into a pattern block", async () => {
    const created = await createNote(userA.id, {
      title: "Pattern with src",
      blocks: [
        {
          ...patternBlock("b1", "hammer"),
          src: "https://example.com/evil.png",
        },
      ],
    });
    const read = await getNote(userA.id, created.note.id);
    expect(read.note.blocks[0]).toMatchObject({ type: "pattern", patternId: "hammer" });
    expect(read.note.blocks[0]).not.toHaveProperty("src");
  });

  it("keeps the pattern id on duplication, with fresh block ids", async () => {
    const created = await createNote(userA.id, {
      title: "Original",
      blocks: [patternBlock("b1", "morning-star")],
    });
    const copy = await duplicateNote(userA.id, created.note.id, {});
    expect(copy.note.blocks[0]).toMatchObject({ type: "pattern", patternId: "morning-star" });
    expect(copy.note.blocks[0].id).not.toBe("b1");
  });

  it("instantiates the built-in candlestick study template with its pattern", async () => {
    const created = await instantiateTemplate(userA.id, {
      templateId: "tpl-candlestick-pattern",
    });
    const pattern = created.note.blocks.find((b) => b.type === "pattern");
    expect(pattern?.patternId).toBe("doji");
  });

  it("finds a note by pattern name even when the pattern block text is empty", async () => {
    const created = await createNote(userA.id, {
      title: "Pattern only",
      blocks: [patternBlock("b1", "doji")],
    });
    const { results, total } = await searchNotes(userA.id, "Doji");
    expect(total).toBeGreaterThanOrEqual(1);
    const found = results.find((r) => r.id === created.note.id);
    expect(found).toBeDefined();
    expect(found!.snippet).toContain("Doji");
    // No duplicate rows for one matching note.
    expect(results.filter((r) => r.id === created.note.id)).toHaveLength(1);
  });

  it("keeps the pattern id through version snapshot and restore", async () => {
    const created = await createNote(userA.id, {
      title: "Versioned",
      blocks: [patternBlock("b1", "hammer")],
    });
    await updateNote(userA.id, created.note.id, {
      title: "Versioned (edited)",
      blocks: [
        patternBlock("b1", "hammer"),
        { id: "b2", type: "paragraph", text: "added later" },
      ],
    });
    const { versions } = await listVersions(userA.id, created.note.id);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    const restored = await restoreVersion(userA.id, created.note.id, versions[0].id);
    expect(restored.note.blocks[0]).toMatchObject({ type: "pattern", patternId: "hammer" });
    // The restored version is readable and still shows the pattern.
    const detail = await getVersion(userA.id, created.note.id, versions[0].id);
    expect(detail.version.blocks[0]).toMatchObject({ type: "pattern", patternId: "hammer" });
  });

  it("isolates pattern notes between users", async () => {
    const created = await createNote(userA.id, {
      title: "Private pattern",
      blocks: [patternBlock("b1", "doji")],
    });
    await expect(getNote(userB.id, created.note.id)).rejects.toThrow();
    await expect(
      updateNote(userB.id, created.note.id, {
        blocks: [patternBlock("b1", "hammer")],
      }),
    ).rejects.toThrow();
    const { results } = await searchNotes(userB.id, "Doji");
    expect(results.find((r) => r.id === created.note.id)).toBeUndefined();
  });
});
