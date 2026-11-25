/**
 * Lot 6 (roadmap section 8) - regression tests: a soft-deleted Journal
 * entry must appear neither in the calendar nor in the exported PDF data.
 *
 * The trash extension already filters deleted rows from default reads; the
 * server functions filter explicitly too (defense in depth), and these
 * tests lock the observable behavior: calendar markers (month + year),
 * export data, single-day read, history, restore, purge and isolation.
 * Dates use March 2032 so no other integration file can collide with them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { createUserWithDefaults } from "@/server/users";
import {
  deleteJournalEntry,
  getJournalEntry,
  getJournalExportData,
  journalDays,
  listRecentJournal,
  upsertJournalEntry,
} from "@/server/journal";
import { getCalendar, getYearDays } from "@/server/calendar";
import {
  deleteTrashItemsPermanently,
  listTrash,
  restoreTrashItems,
  trashCounts,
} from "@/server/trash";

let userA: { id: string };
let userB: { id: string };

beforeAll(async () => {
  const a = await createUserWithDefaults({
    email: "journal-del-a@test.local",
    password: "Test1234!",
    displayName: "Journal Del A",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  const b = await createUserWithDefaults({
    email: "journal-del-b@test.local",
    password: "Test1234!",
    displayName: "Journal Del B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.$disconnect();
});

describe("soft-deleted journal entries stay out of the calendar", () => {
  it("journalDays and the month calendar exclude a trashed day", async () => {
    await upsertJournalEntry(userA.id, {
      date: "2032-03-05",
      keyLesson: "kept",
    });
    await upsertJournalEntry(userA.id, {
      date: "2032-03-06",
      keyLesson: "trashed",
    });
    expect(await deleteJournalEntry(userA.id, "2032-03-06")).toBe(true);
    // Second delete is a no-op: the entry is already in the trash.
    expect(await deleteJournalEntry(userA.id, "2032-03-06")).toBe(false);

    const days = await journalDays(userA.id, "2032-03-01", "2032-03-31");
    expect(days.has("2032-03-05")).toBe(true);
    expect(days.has("2032-03-06")).toBe(false);

    const payload = await getCalendar(userA.id, { year: 2032, month: 3 });
    expect(payload.days["2032-03-05"]?.hasJournal).toBe(true);
    expect(payload.days["2032-03-06"]).toBeUndefined();
  });

  it("the year calendar shows no journal flag or discipline for a trashed day", async () => {
    await upsertJournalEntry(userA.id, {
      date: "2032-03-15",
      disciplineScore: 4,
    });
    await upsertJournalEntry(userA.id, {
      date: "2032-03-16",
      disciplineScore: 5,
    });
    await deleteJournalEntry(userA.id, "2032-03-16");

    const year = await getYearDays(userA.id, 2032);
    expect(year.days["2032-03-15"]?.hasJournal).toBe(true);
    expect(year.days["2032-03-15"]?.discipline).toBe(4);
    expect(year.days["2032-03-16"]).toBeUndefined();
  });
});

describe("soft-deleted journal entries stay out of the export", () => {
  it("getJournalExportData excludes trashed entries", async () => {
    await upsertJournalEntry(userA.id, {
      date: "2032-03-10",
      keyLesson: "kept in export",
    });
    await upsertJournalEntry(userA.id, {
      date: "2032-03-11",
      keyLesson: "trashed out of export",
    });
    await deleteJournalEntry(userA.id, "2032-03-11");

    const data = await getJournalExportData(userA.id, "2032-03-01", "2032-03-31");
    const dates = data.entries.map((entry) => entry.date);
    expect(dates).toContain("2032-03-10");
    expect(dates).not.toContain("2032-03-11");
  });

  it("single-day read and history exclude trashed entries", async () => {
    await upsertJournalEntry(userA.id, {
      date: "2032-03-20",
      keyLesson: "trashed single day",
    });
    await deleteJournalEntry(userA.id, "2032-03-20");

    expect(await getJournalEntry(userA.id, "2032-03-20")).toBeNull();
    const page = await listRecentJournal(userA.id, 30, {
      from: "2032-03-01",
      to: "2032-03-31",
    });
    expect(page.entries.map((entry) => entry.date)).not.toContain("2032-03-20");
  });
});

describe("journal trash: restore and purge", () => {
  it("restore via trash brings the entry back to calendar and export", async () => {
    const entry = await upsertJournalEntry(userA.id, {
      date: "2032-03-21",
      keyLesson: "restored",
    });
    await deleteJournalEntry(userA.id, "2032-03-21");
    expect((await trashCounts(userA.id)).JOURNAL_ENTRY).toBeGreaterThanOrEqual(1);
    expect(await journalDays(userA.id, "2032-03-01", "2032-03-31")).not.toContain(
      "2032-03-21",
    );

    const { restored } = await restoreTrashItems(userA.id, [
      { entity: "JOURNAL_ENTRY", id: entry.id },
    ]);
    expect(restored).toBe(1);

    expect(await journalDays(userA.id, "2032-03-01", "2032-03-31")).toContain(
      "2032-03-21",
    );
    const data = await getJournalExportData(userA.id, "2032-03-01", "2032-03-31");
    expect(data.entries.map((item) => item.date)).toContain("2032-03-21");
    const trash = await listTrash(userA.id, { entity: "JOURNAL_ENTRY" });
    expect(trash.items.some((item) => item.id === entry.id)).toBe(false);
  });

  it("permanent purge removes the entry and frees the date", async () => {
    const entry = await upsertJournalEntry(userA.id, {
      date: "2032-03-22",
      keyLesson: "purged",
    });
    await deleteJournalEntry(userA.id, "2032-03-22");

    const { deleted } = await deleteTrashItemsPermanently(userA.id, [
      { entity: "JOURNAL_ENTRY", id: entry.id },
    ]);
    expect(deleted).toBe(1);
    expect(
      await withDeleted(() =>
        db.journalEntry.findUnique({ where: { id: entry.id } }),
      ),
    ).toBeNull();

    // The (user, date) unique key is free again: a fresh entry is created.
    const fresh = await upsertJournalEntry(userA.id, {
      date: "2032-03-22",
      keyLesson: "recreated after purge",
    });
    expect(fresh.id).not.toBe(entry.id);
    expect(fresh.keyLesson).toBe("recreated after purge");
  });

  it("user B cannot restore or purge user A's trashed entry", async () => {
    const entry = await upsertJournalEntry(userA.id, {
      date: "2032-03-25",
      keyLesson: "A only",
    });
    await deleteJournalEntry(userA.id, "2032-03-25");

    expect(
      await restoreTrashItems(userB.id, [{ entity: "JOURNAL_ENTRY", id: entry.id }]),
    ).toEqual({ restored: 0 });
    expect(
      await deleteTrashItemsPermanently(userB.id, [
        { entity: "JOURNAL_ENTRY", id: entry.id },
      ]),
    ).toEqual({ deleted: 0 });

    // Still in A's trash, invisible in B's calendar and export.
    const trash = await listTrash(userA.id, { entity: "JOURNAL_ENTRY" });
    expect(trash.items.some((item) => item.id === entry.id)).toBe(true);
    expect(await journalDays(userB.id, "2032-03-01", "2032-03-31")).not.toContain(
      "2032-03-25",
    );
    const dataB = await getJournalExportData(userB.id, "2032-03-01", "2032-03-31");
    expect(dataB.entries.map((item) => item.date)).not.toContain("2032-03-25");

    // Cleanup: A purges its own entry.
    expect(
      await deleteTrashItemsPermanently(userA.id, [
        { entity: "JOURNAL_ENTRY", id: entry.id },
      ]),
    ).toEqual({ deleted: 1 });
  });
});

describe("journal date stability", () => {
  it("the journal date is a literal local day, stable across a timezone change", async () => {
    await upsertJournalEntry(userA.id, {
      date: "2032-03-26",
      keyLesson: "timezone-proof",
    });
    await db.profile.update({
      where: { id: userA.id },
      data: { timezone: "Pacific/Kiritimati" },
    });
    try {
      expect(await journalDays(userA.id, "2032-03-01", "2032-03-31")).toContain(
        "2032-03-26",
      );
      expect(await getJournalEntry(userA.id, "2032-03-26")).not.toBeNull();
    } finally {
      await db.profile.update({
        where: { id: userA.id },
        data: { timezone: "America/Toronto" },
      });
    }
  });

  it("repeated saves update the same row, never a duplicate", async () => {
    await upsertJournalEntry(userA.id, { date: "2032-03-27", keyLesson: "v1" });
    await upsertJournalEntry(userA.id, { date: "2032-03-27", keyLesson: "v2" });
    await upsertJournalEntry(userA.id, { date: "2032-03-27", keyLesson: "v3" });

    const rows = await withDeleted(() =>
      db.journalEntry.findMany({
        where: { userId: userA.id, date: "2032-03-27" },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyLesson).toBe("v3");
    expect(await journalDays(userA.id, "2032-03-01", "2032-03-31")).toContain(
      "2032-03-27",
    );
  });
});
