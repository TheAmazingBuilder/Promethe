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
import { foldText } from "@/lib/search/text";
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
    keyLevels: e.keyLevels,
    primaryScenario: e.primaryScenario,
    alternateScenario: e.alternateScenario,
    invalidationConditions: e.invalidationConditions,
    maxRiskPercent: e.maxRiskPercent,
    mood: e.mood,
    sleepQuality: e.sleepQuality,
    disciplineScore: e.disciplineScore,
    stressLevel: e.stressLevel,
    energyLevel: e.energyLevel,
    focusLevel: e.focusLevel,
    keyLesson: e.keyLesson,
    marketBias: e.marketBias,
    nextSessionCommitment: e.nextSessionCommitment,
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
export interface JournalHistoryFilters {
  q?: string;
  from?: string;
  to?: string;
  mood?: number;
  discipline?: number;
}

export interface JournalHistoryPage {
  entries: JournalEntryDTO[];
  hasMore: boolean;
}

export async function listRecentJournal(
  userId: string,
  limit = 30,
  filters: JournalHistoryFilters = {},
  offset = 0,
): Promise<JournalHistoryPage> {
  const terms = filters.q?.trim()
    ? foldText(filters.q).split(" ").filter(Boolean).slice(0, 8)
    : [];
  const rows = await db.journalEntry.findMany({
    where: {
      userId,
      ...(filters.from || filters.to
        ? {
            date: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.mood != null ? { mood: filters.mood } : {}),
      ...(filters.discipline != null ? { disciplineScore: filters.discipline } : {}),
      ...(terms.length > 0
        ? { AND: terms.map((term) => ({ searchText: { contains: term } })) }
        : {}),
    },
    orderBy: { date: "desc" },
    skip: Math.max(0, offset),
    take: Math.max(1, Math.min(limit, 100)) + 1,
  });
  const hasMore = rows.length > Math.max(1, Math.min(limit, 100));
  return {
    entries: rows.slice(0, Math.max(1, Math.min(limit, 100))).map(toJournalDTO),
    hasMore,
  };
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
        keyLevels: input.keyLevels ?? null,
        primaryScenario: input.primaryScenario ?? null,
        alternateScenario: input.alternateScenario ?? null,
        invalidationConditions: input.invalidationConditions ?? null,
        maxRiskPercent: input.maxRiskPercent ?? null,
        mood: input.mood ?? null,
        sleepQuality: input.sleepQuality ?? null,
        disciplineScore: input.disciplineScore ?? null,
        stressLevel: input.stressLevel ?? null,
        energyLevel: input.energyLevel ?? null,
        focusLevel: input.focusLevel ?? null,
        keyLesson: input.keyLesson ?? null,
        marketBias: input.marketBias ?? null,
        nextSessionCommitment: input.nextSessionCommitment ?? null,
      },
      update: {
        preMarketPlan: input.preMarketPlan ?? null,
        postMarketReview: input.postMarketReview ?? null,
        keyLevels: input.keyLevels ?? null,
        primaryScenario: input.primaryScenario ?? null,
        alternateScenario: input.alternateScenario ?? null,
        invalidationConditions: input.invalidationConditions ?? null,
        maxRiskPercent: input.maxRiskPercent ?? null,
        mood: input.mood ?? null,
        sleepQuality: input.sleepQuality ?? null,
        disciplineScore: input.disciplineScore ?? null,
        stressLevel: input.stressLevel ?? null,
        energyLevel: input.energyLevel ?? null,
        focusLevel: input.focusLevel ?? null,
        keyLesson: input.keyLesson ?? null,
        marketBias: input.marketBias ?? null,
        nextSessionCommitment: input.nextSessionCommitment ?? null,
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

/** Days (YYYY-MM-DD) with a journal entry - calendar markers. Soft-deleted
 * entries are excluded explicitly (the trash extension also filters them,
 * but the calendar must never depend on that alone). */
export async function journalDays(
  userId: string,
  first: string,
  last: string
): Promise<Set<string>> {
  const rows = await db.journalEntry.findMany({
    where: { userId, deletedAt: null, date: { gte: first, lte: last } },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date));
}


export interface JournalPeriodReviewInput {
  periodType: "WEEKLY" | "MONTHLY";
  periodStart: string;
  periodEnd: string;
  whatWentWell?: string | null;
  whatToImprove?: string | null;
  keyLesson?: string | null;
  nextCommitment?: string | null;
}

export async function getJournalPeriodReview(
  userId: string,
  periodType: JournalPeriodReviewInput["periodType"],
  periodStart: string,
) {
  return db.journalPeriodReview.findUnique({
    where: {
      userId_periodType_periodStart: { userId, periodType, periodStart },
    },
  });
}

export async function upsertJournalPeriodReview(
  userId: string,
  input: JournalPeriodReviewInput,
) {
  const unique = {
    userId_periodType_periodStart: {
      userId,
      periodType: input.periodType,
      periodStart: input.periodStart,
    },
  };
  const values = {
    periodEnd: input.periodEnd,
    whatWentWell: input.whatWentWell ?? null,
    whatToImprove: input.whatToImprove ?? null,
    keyLesson: input.keyLesson ?? null,
    nextCommitment: input.nextCommitment ?? null,
  };
  return db.journalPeriodReview.upsert({
    where: unique,
    create: { ...values, userId, periodType: input.periodType, periodStart: input.periodStart },
    update: values,
  });
}


export interface JournalTemplateInput {
  name: string;
  description?: string | null;
  marketBias?: string | null;
  preMarketPlan?: string | null;
  keyLevels?: string | null;
  primaryScenario?: string | null;
  alternateScenario?: string | null;
  invalidationConditions?: string | null;
  maxRiskPercent?: string | null;
}

export async function listJournalTemplates(userId: string) {
  return db.journalTemplate.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function createJournalTemplate(userId: string, input: JournalTemplateInput) {
  return db.journalTemplate.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      marketBias: input.marketBias ?? null,
      preMarketPlan: input.preMarketPlan ?? null,
      keyLevels: input.keyLevels ?? null,
      primaryScenario: input.primaryScenario ?? null,
      alternateScenario: input.alternateScenario ?? null,
      invalidationConditions: input.invalidationConditions ?? null,
      maxRiskPercent: input.maxRiskPercent ?? null,
    },
  });
}

export type JournalTemplateUpdate = Partial<JournalTemplateInput> & {
  isDefault?: boolean;
};

export async function updateJournalTemplate(
  userId: string,
  id: string,
  input: JournalTemplateUpdate,
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.journalTemplate.findFirst({ where: { id, userId } });
    if (!existing) return null;

    if (input.isDefault === true) {
      await tx.journalTemplate.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const { isDefault, ...fields } = input;
    return tx.journalTemplate.update({
      where: { id },
      data: {
        ...fields,
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });
  });
}

export async function deleteJournalTemplate(userId: string, id: string): Promise<boolean> {
  const result = await db.journalTemplate.deleteMany({ where: { id, userId } });
  return result.count > 0;
}


export async function getJournalExportData(userId: string, from: string, to: string) {
  const [entries, periodReviews, account] = await Promise.all([
    db.journalEntry.findMany({
      // Soft-deleted entries never leak into the exported PDF (explicit
      // filter - the trash extension also filters them, but the export
      // must never depend on that alone).
      where: { userId, deletedAt: null, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
    db.journalPeriodReview.findMany({
      where: {
        userId,
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
      orderBy: [{ periodStart: "asc" }, { periodType: "asc" }],
    }),
    db.account.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { currency: true },
    }),
  ]);
  return {
    entries: entries.map(toJournalDTO),
    periodReviews,
    currency: account?.currency ?? "USD",
  };
}
