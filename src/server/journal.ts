/**
 * Journal entries (v1 phase 5) — one entry per user per LOCAL day.
 * Upsert on (userId, date) — the unique key defined in the schema.
 *
 * v2.5 Module 4: soft delete (trash) + searchText maintenance. The upsert
 * runs against the trashed row too (upsert is not intercepted by the
 * soft-delete extension), so a trashed entry for the same date is
 * RESTORED as part of the write — the user's new entry is never written
 * into an invisible row.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withDeleted } from "@/lib/trash/deleted-scope";
import { refreshJournalSearchText } from "@/server/search-index";
import type { JournalEntryDTO } from "@/lib/trading/dto";
import type { JournalEntryInput } from "@/lib/validations/journal";

type JournalRow = Prisma.JournalEntryGetPayload<Record<string, never>>;

export function toJournalDTO(e: JournalRow): JournalEntryDTO {
  return {
    id: e.id,
    date: e.date,
    preMarketPlan: e.preMarketPlan,
    postMarketReview: e.postMarketReview,
    mood: e.mood,
    sleepQuality: e.sleepQuality,
    disciplineScore: e.disciplineScore,
    keyLesson: e.keyLesson,
    marketBias: e.marketBias,
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function getJournalEntry(
  userId: string,
  date: string
): Promise<JournalEntryDTO | null> {
  const row = await db.journalEntry.findFirst({ where: { userId, date } });
  return row ? toJournalDTO(row) : null;
}

/** Most recent entries for the journal index (last 90 days of activity). */
export async function listRecentJournal(
  userId: string,
  limit = 30
): Promise<JournalEntryDTO[]> {
  const rows = await db.journalEntry.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: limit,
  });
  return rows.map(toJournalDTO);
}

export async function upsertJournalEntry(
  userId: string,
  input: JournalEntryInput
): Promise<JournalEntryDTO> {
  const row = await withDeleted(() =>
    db.journalEntry.upsert({
      where: { userId_date: { userId, date: input.date } },
      create: {
        userId,
        date: input.date,
        preMarketPlan: input.preMarketPlan ?? null,
        postMarketReview: input.postMarketReview ?? null,
        mood: input.mood ?? null,
        sleepQuality: input.sleepQuality ?? null,
        disciplineScore: input.disciplineScore ?? null,
        keyLesson: input.keyLesson ?? null,
        marketBias: input.marketBias ?? null,
      },
      update: {
        preMarketPlan: input.preMarketPlan ?? null,
        postMarketReview: input.postMarketReview ?? null,
        mood: input.mood ?? null,
        sleepQuality: input.sleepQuality ?? null,
        disciplineScore: input.disciplineScore ?? null,
        keyLesson: input.keyLesson ?? null,
        marketBias: input.marketBias ?? null,
        // Re-writing a trashed entry restores it (see module doc).
        deletedAt: null,
        deletedBy: null,
      },
    })
  );
  // v2.5 M4 — maintain the normalized search column (§4.2).
  await refreshJournalSearchText(row.id);
  return toJournalDTO(row);
}

/** Soft delete → trash (30-day retention, restorable, excluded everywhere). */
export async function deleteJournalEntry(
  userId: string,
  date: string
): Promise<boolean> {
  const updated = await db.journalEntry.updateMany({
    where: { userId, date, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
  return updated.count > 0;
}

/** Days (YYYY-MM-DD) with a journal entry - calendar markers. */
export async function journalDays(
  userId: string,
  first: string,
  last: string
): Promise<Set<string>> {
  const rows = await db.journalEntry.findMany({
    where: { userId, date: { gte: first, lte: last } },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date));
}
