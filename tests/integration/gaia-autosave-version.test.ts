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
  it("allows only one concurrent content save from the same version", async () => {
    const created = await createNote(userId, {
      title: "Concurrent autosave base",
      blocks: blocks("Concurrent base content"),
    });
    const concurrentNoteId = created.note.id;
    const base = await getNote(userId, concurrentNoteId);
    const expectedUpdatedAt = base.note.updatedAt;

    const results = await Promise.allSettled([
      updateNote(userId, concurrentNoteId, {
        title: "Concurrent writer A",
        expectedUpdatedAt,
      }),
      updateNote(userId, concurrentNoteId, {
        title: "Concurrent writer B",
        expectedUpdatedAt,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "NOTE_CONFLICT",
      status: 409,
    });

    const finalNote = await getNote(userId, concurrentNoteId);
    expect(["Concurrent writer A", "Concurrent writer B"]).toContain(
      finalNote.note.title,
    );

    // The losing writer must not create a second snapshot for the same base.
    const snapshots = await db.noteVersion.count({
      where: { userId, noteId: concurrentNoteId },
    });
    expect(snapshots).toBe(1);
  });

});
