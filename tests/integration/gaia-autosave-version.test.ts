/**
 * Gaïa autosave version regression.
 *
 * Viewing a note updates lastViewedAt, but must not advance updatedAt:
 * the editor sends updatedAt back as its optimistic-concurrency token.
 * These integration tests run against the isolated PostgreSQL schema
 * promethe_test configured by vitest.config.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import { createNote, getNote, updateNote } from "@/server/gaia";

let userId: string;
let noteId: string;
const originalUpdatedAt = new Date("2025-01-15T12:00:00.000Z");

const blocks = (text: string) => [
  { id: "autosave-block", type: "paragraph", text },
];

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "gaia-autosave-version@test.local",
    password: "Test1234!",
    displayName: "Gaia Autosave Version Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userId = created.user.id;

  const note = await createNote(userId, {
    title: "Autosave version token",
    blocks: blocks("Initial content"),
  });
  noteId = note.note.id;

  // Use a deterministic, old version so the metadata touch is observable
  // even when the test runs very quickly.
  await db.note.update({
    where: { id: noteId },
    data: {
      updatedAt: originalUpdatedAt,
      lastViewedAt: originalUpdatedAt,
    },
  });
});

afterAll(async () => {
  if (userId) {
    await db.user.deleteMany({ where: { id: userId } });
  }
  await db.$disconnect();
});

describe("Gaïa autosave version token", () => {
  it("keeps updatedAt stable when getNote records a view", async () => {
    const response = await getNote(userId, noteId);

    expect(response.note.updatedAt).toBe(originalUpdatedAt.toISOString());
    expect(response.note.lastViewedAt).not.toBeNull();
    expect(new Date(response.note.lastViewedAt!).getTime()).toBeGreaterThan(
      originalUpdatedAt.getTime(),
    );
  });

  it("keeps the token stable for touchViewed and accepts the next content save", async () => {
    const viewed = await updateNote(userId, noteId, { touchViewed: true });

    expect(viewed.note.updatedAt).toBe(originalUpdatedAt.toISOString());

    const saved = await updateNote(userId, noteId, {
      title: "Autosave version token - updated",
      blocks: blocks("Initial content plus a saved edit"),
      expectedUpdatedAt: originalUpdatedAt.toISOString(),
    });

    expect(saved.note.title).toBe("Autosave version token - updated");
    expect(saved.note.blocks[0]?.text).toBe("Initial content plus a saved edit");
    expect(saved.note.updatedAt).not.toBe(originalUpdatedAt.toISOString());
  });

  it("still rejects a genuinely stale editor version", async () => {
    const current = await getNote(userId, noteId);

    await expect(
      updateNote(userId, noteId, {
        title: "Stale overwrite must be rejected",
        expectedUpdatedAt: originalUpdatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({
      code: "NOTE_CONFLICT",
      status: 409,
    });

    expect(current.note.title).toBe("Autosave version token - updated");
  });
});
