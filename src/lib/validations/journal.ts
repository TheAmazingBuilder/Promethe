/**
 * Zod schemas for the journal & calendar domain (v1 phase 5) — shared by the
 * client form and the API routes. Client-safe: imports zod only.
 *
 * JournalEntry.date is a calendar day "YYYY-MM-DD" in the USER's timezone
 * (documented convention — avoids UTC day drift, see README).
 */
import { z } from "zod";

/** Calendar day, local to the user's timezone. */
export const isoDay = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "invalidDate");

const score = z.number().int().min(1, "invalidScore").max(5, "invalidScore");

export const journalEntrySchema = z.object({
  date: isoDay,
  preMarketPlan: z.string().max(20000, "tooLong").nullish(),
  postMarketReview: z.string().max(20000, "tooLong").nullish(),
  mood: score.nullish(),
  sleepQuality: score.nullish(),
  disciplineScore: score.nullish(),
  keyLesson: z.string().max(2000, "tooLong").nullish(),
  marketBias: z.string().max(500, "tooLong").nullish(),
});

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

/** GET /api/journal — either ?date=YYYY-MM-DD (single day) or no param (recent list). */
export const journalQuerySchema = z.object({
  date: isoDay.optional(),
});

/** DELETE /api/journal?date=YYYY-MM-DD */
export const journalDeleteQuerySchema = z.object({
  date: isoDay,
});

/** GET /api/calendar?year=2025&month=5&account=… */
export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000, "invalidDate").max(2100, "invalidDate"),
  month: z.coerce.number().int().min(1, "invalidDate").max(12, "invalidDate"),
  account: z.string().trim().min(1).max(40).optional(),
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
