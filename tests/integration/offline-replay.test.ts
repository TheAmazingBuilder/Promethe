/**
 * Offline replay (§25.5) - server-side idempotency and conflict rules
 * (PostgreSQL schema promethe_test).
 *
 * Covers: note create dedupes on clientMutationId (replay twice creates
 * one row), journal and note conflict 409 on a stale base with the
 * server version kept, force resolution with the server base, and the
 * rule that a refused update never burns a Gaïa version slot. Dates
 * use March 2033 so no other integration file can collide with them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createNote,
  listVersions,
  updateNote,
} from "@/server/gaia";
import {
  JournalConflictError,
  getJournalEntry,
  upsertJournalEntry,
} from "@/server/journal";

let userA: { id: string };
let userB: { id: string };

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
password: "Test1234!",
    displayName: "Offline Replay",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  return { user };
}

const blocks = (text: string) => [{ id: "b1", type: "paragraph", text }];

beforeAll(async () => {
  const a = await makeUser("offline-a@test.local");
  userA = a.user;
  const b = await makeUser("offline-b@test.local");
  userB = b.user;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("note create idempotency (clientMutationId)", () => {
  it("replaying the same key twice creates exactly one note", async () => {
    const key = "offline-note-dedupe-1";
    const first = await createNote(userA.id, {
      title: "Offline note",
      blocks: blocks("written offline"),
      clientMutationId: key,
    });
    expect(first.deduplicated).toBe(false);
    const second = await createNote(userA.id, {
      title: "Offline note",
      blocks: blocks("written offline"),
      clientMutationId: key,
    });
    expect(second.deduplicated).toBe(true);
    expect(second.note.id).toBe(first.note.id);
    const rows = await db.note.findMany({
      where: { userId: userA.id, clientMutationId: key },
    });
    expect(rows).toHaveLength(1);
  });

  it("the same key is scoped per user", async () => {
    const key = "offline-note-shared-key";
    const a = await createNote(userA.id, {
      title: "A note",
      blocks: blocks("a"),
      clientMutationId: key,
    });
    const b = await createNote(userB.id, {
      title: "B note",
      blocks: blocks("b"),
      clientMutationId: key,
    });
    expect(b.note.id).not.toBe(a.note.id);
    expect(b.deduplicated).toBe(false);
  });

  it("server validation still applies on replay (unknown folder)", async () => {
    await expect(
      createNote(userA.id, {
        title: "Bad folder",
        blocks: blocks("x"),
        folderId: "does-not-exist",
        clientMutationId: "offline-note-bad-folder",
      }),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_FOUND" });
  });
});

describe("journal conflict (expectedUpdatedAt)", () => {
  const date = "2033-03-14";

  it("a stale base throws with the server entry kept", async () => {
    const created = await upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "original plan",
    });
    const base = created.updatedAt;
    // Another device edits the entry (its updatedAt moves forward).
    await db.journalEntry.update({
      where: { userId_date: { userId: userA.id, date } },
      data: {
        preMarketPlan: "edited elsewhere",
        updatedAt: new Date(Date.now() + 5000),
      },
    });
    const attempt = upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "my offline edit",
      expectedUpdatedAt: base,
    });
    await expect(attempt).rejects.toBeInstanceOf(JournalConflictError);
    let caught: JournalConflictError | null = null;
    try {
      await attempt;
    } catch (error) {
      caught = error as JournalConflictError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.serverEntry.preMarketPlan).toBe("edited elsewhere");
    expect(caught?.baseUpdatedAt).toBe(base);
    // The server row is untouched by the refused replay.
    expect((await getJournalEntry(userA.id, date))?.preMarketPlan).toBe(
      "edited elsewhere",
    );
  });

  it("force with the server base applies the offline edit", async () => {
    const current = await getJournalEntry(userA.id, date);
    const updated = await upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "my offline edit",
      expectedUpdatedAt: current?.updatedAt,
      force: true,
    });
    expect(updated.preMarketPlan).toBe("my offline edit");
  });

  it("an upsert without a base applies (no conflict check)", async () => {
    // The journal upsert is a full replace: fields absent from the call
    // are cleared, so the plan is passed again here.
    const updated = await upsertJournalEntry(userA.id, {
      date,
      preMarketPlan: "my offline edit",
      postMarketReview: "review without base",
    });
    expect(updated.postMarketReview).toBe("review without base");
    expect(updated.preMarketPlan).toBe("my offline edit");
  });
});

describe("note conflict (expectedUpdatedAt)", () => {
  it("a stale base on a content edit returns a 409 with the server note", async () => {
    const created = await createNote(userA.id, {
      title: "Conflict note",
      blocks: blocks("v1"),
      clientMutationId: "offline-note-conflict-1",
    });
    const base = created.note.updatedAt;
    await db.note.update({
      where: { id: created.note.id },
      data: {
        title: "edited elsewhere",
        updatedAt: new Date(Date.now() + 5000),
      },
    });
    const attempt = updateNote(userA.id, created.note.id, {
      title: "my offline title",
      expectedUpdatedAt: base,
    });
    await expect(attempt).rejects.toMatchObject({
      code: "NOTE_CONFLICT",
      status: 409,
    });
    let caught: unknown = null;
    try {
      await attempt;
    } catch (error) {
      caught = error;
    }
    const details = (caught as { details?: { note?: { title?: string } } })
      .details;
    expect(details?.note?.title).toBe("edited elsewhere");
    // No version slot burned by the refused update.
    expect((await listVersions(userA.id, created.note.id)).versions).toHaveLength(0);
  });

  it("a metadata-only patch applies without a base check", async () => {
    const created = await createNote(userA.id, {
      title: "Meta note",
      blocks: blocks("v1"),
      clientMutationId: "offline-note-meta-1",
    });
    const updated = await updateNote(userA.id, created.note.id, {
      favorite: true,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(updated.note.favorite).toBe(true);
  });

  it("force with the server base applies the content edit", async () => {
    const created = await createNote(userA.id, {
      title: "Force note",
      blocks: blocks("v1"),
      clientMutationId: "offline-note-force-1",
    });
    await db.note.update({
      where: { id: created.note.id },
      data: {
        title: "edited elsewhere",
        updatedAt: new Date(Date.now() + 5000),
      },
    });
    const server = await db.note.findUniqueOrThrow({
      where: { id: created.note.id },
    });
    const updated = await updateNote(userA.id, created.note.id, {
      title: "my offline title",
      expectedUpdatedAt: server.updatedAt.toISOString(),
      force: true,
    });
    expect(updated.note.title).toBe("my offline title");
  });
});
