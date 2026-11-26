/**
 * Lot 11 (roadmap §15) - Gaïa: content-only versioning, ranked search
 * with a true total, duplicate title in English, version preview data,
 * and cross-user isolation (PostgreSQL schema promethe_test).
 *
 * The audit found versions were snapshotted on ANY change (a favorite
 * toggle burned a version slot with an identical copy), search was
 * substring + recency with a capped total, and the duplicate title was
 * French ("(copie)") in an English-only app.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createNote,
  duplicateNote,
  getVersion,
  listVersions,
  searchNotes,
  updateNote,
} from "@/server/gaia";

let userA: { id: string };
let userB: { id: string };
let noteId: string;

async function makeUser(email: string) {
  const { user } = await createUserWithDefaults({
    email,
    password: "Test1234!",
    displayName: "Lot 11 Gaia",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  return { user };
}

const blocks = (text: string) => [
  { id: "b1", type: "paragraph", text },
];

beforeAll(async () => {
  const a = await makeUser("gaia11-a@test.local");
  userA = a.user;
  const b = await makeUser("gaia11-b@test.local");
  userB = b.user;

  const created = await createNote(userA.id, {
    title: "Gold setup",
    blocks: blocks("Gold is heavy and slow."),
  });
  noteId = created.note.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("content-only versioning", () => {
  it("does not burn a version slot on metadata-only changes", async () => {
    expect((await listVersions(userA.id, noteId)).versions).toHaveLength(0);

    await updateNote(userA.id, noteId, { favorite: true });
    expect((await listVersions(userA.id, noteId)).versions).toHaveLength(0);

    await updateNote(userA.id, noteId, { icon: "📈" });
    expect((await listVersions(userA.id, noteId)).versions).toHaveLength(0);
  });

  it("snapshots on content change, and the version carries the old blocks", async () => {
    await updateNote(userA.id, noteId, {
      blocks: blocks("Gold is heavy and slow. Added: wait for the sweep."),
    });
    const versions = (await listVersions(userA.id, noteId)).versions;
    expect(versions).toHaveLength(1);

    const detail = await getVersion(userA.id, noteId, versions[0].id);
    expect(detail.version.title).toBe("Gold setup");
    expect(detail.version.blocks[0].text).toBe("Gold is heavy and slow.");

    // A title change is content too, but versions are throttled to one
    // per 3 minutes: an immediate second content change does not burn
    // another slot.
    await updateNote(userA.id, noteId, { title: "Gold setup v2" });
    expect((await listVersions(userA.id, noteId)).versions).toHaveLength(1);
  });
});

describe("ranked search", () => {
  it("ranks a title hit above a body hit, folds accents, and reports the true total", async () => {
    await createNote(userA.id, {
      title: "Café du matin",
      blocks: blocks("Morning routine."),
    });
    await createNote(userA.id, {
      title: "Other note",
      blocks: blocks("gold is mentioned here only"),
    });

    const gold = await searchNotes(userA.id, "gold");
    expect(gold.total).toBe(2);
    expect(gold.results.map((r) => r.title)).toEqual([
      "Gold setup v2",
      "Other note",
    ]);

    const cafe = await searchNotes(userA.id, "cafe");
    expect(cafe.total).toBe(1);
    expect(cafe.results[0].title).toBe("Café du matin");
  });

  it("returns at most 30 rows but the real total above 30 matches", async () => {
    for (let i = 0; i < 32; i += 1) {
      await createNote(userA.id, {
        title: `Zebra ${i}`,
        blocks: blocks("zebra stripes"),
      });
    }
    const found = await searchNotes(userA.id, "zebra");
    expect(found.results).toHaveLength(30);
    expect(found.total).toBe(32);
  });
});

describe("duplicate + isolation", () => {
  it("duplicates with an English (copy) suffix", async () => {
    const copy = await duplicateNote(userA.id, noteId, {});
    expect(copy.note.title).toBe("Gold setup v2 (copy)");
  });

  it("keeps user B out: no search hits, no versions, no version detail, no duplicate", async () => {
    const found = await searchNotes(userB.id, "gold");
    expect(found.total).toBe(0);
    expect(found.results).toEqual([]);

    const versions = await listVersions(userB.id, noteId);
    expect(versions.versions).toEqual([]);

    const mine = (await listVersions(userA.id, noteId)).versions;
    expect(mine.length).toBeGreaterThan(0);
    await expect(
      getVersion(userB.id, noteId, mine[0].id),
    ).rejects.toThrow();
    await expect(duplicateNote(userB.id, noteId, {})).rejects.toThrow();
  });
});
