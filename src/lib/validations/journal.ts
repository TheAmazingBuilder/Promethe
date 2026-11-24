/**
 * Zod schemas for the journal & calendar domain (v1 phase 5) — shared by the
 * client form and the API routes. Client-safe: imports zod only.
 *
 * JournalEntry.date is a calendar day "YYYY-MM-DD" in the USER's timezone
 * (documented convention — avoids UTC day drift, see README).
 */
import { z } from "zod";

/** Calendar day, local to the user's timezone. */
function isRealIsoDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const isoDay = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "invalidDate")
  .refine(isRealIsoDay, "invalidDate");

const score = z.number().int().min(1, "invalidScore").max(5, "invalidScore");

export const journalEntrySchema = z.object({
  date: isoDay,
  preMarketPlan: z.string().max(20000, "tooLong").nullish(),
  postMarketReview: z.string().max(20000, "tooLong").nullish(),
  keyLevels: z.string().max(4000, "tooLong").nullish(),
  primaryScenario: z.string().max(4000, "tooLong").nullish(),
  alternateScenario: z.string().max(4000, "tooLong").nullish(),
  invalidationConditions: z.string().max(4000, "tooLong").nullish(),
  maxRiskPercent: z.string().trim().regex(/^(?:[0-9]{1,2}(?:\.[0-9]{1,2})?|100(?:\.0{1,2})?)$/, "invalidRisk").refine((value) => Number(value) > 0, "invalidRisk").nullish(),
  mood: score.nullish(),
  sleepQuality: score.nullish(),
  disciplineScore: score.nullish(),
  stressLevel: score.nullish(),
  energyLevel: score.nullish(),
  focusLevel: score.nullish(),
  keyLesson: z.string().max(2000, "tooLong").nullish(),
  marketBias: z.string().max(500, "tooLong").nullish(),
  nextSessionCommitment: z.string().max(2000, "tooLong").nullish(),
});

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

/** GET /api/v1/journal — one date or filtered Journal history. */
export const journalQuerySchema = z.object({
  date: isoDay.optional(),
  q: z.string().trim().max(120, "tooLong").optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  mood: z.coerce.number().int().min(1).max(5).optional(),
  discipline: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).refine(
  ({ from, to }) => from == null || to == null || from <= to,
  { message: "invalidDate", path: ["from"] },
);

/** DELETE /api/v1/journal?date=YYYY-MM-DD */
export const journalDeleteQuerySchema = z.object({
  date: isoDay,
});

/** GET /api/v1/calendar?year=2025&month=5&account=… */
export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000, "invalidDate").max(2100, "invalidDate"),
  month: z.coerce.number().int().min(1, "invalidDate").max(12, "invalidDate"),
  account: z.string().trim().min(1).max(40).optional(),
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/** GET /api/v1/calendar/day?date=YYYY-MM-DD&account=… — one trading day. */
export const calendarDayQuerySchema = z.object({
  date: isoDay,
  account: z.string().trim().min(1).max(40).optional(),
});

export type CalendarDayQuery = z.infer<typeof calendarDayQuerySchema>;


function isValidJournalPeriodRange(
  periodType: "WEEKLY" | "MONTHLY",
  periodStart: string,
  periodEnd: string,
): boolean {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== periodStart ||
    end.toISOString().slice(0, 10) !== periodEnd
  ) return false;

  if (periodType === "WEEKLY") {
    const daysFromMonday = (start.getUTCDay() + 6) % 7;
    return daysFromMonday === 0 && end.getTime() - start.getTime() === 6 * 24 * 60 * 60 * 1000;
  }

  const firstDay = start.getUTCDate() === 1;
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return firstDay &&
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    end.getUTCDate() === lastDay;
}

export const journalPeriodReviewQuerySchema = z.object({
  periodType: z.enum(["WEEKLY", "MONTHLY"]),
  periodStart: isoDay,
});

export const journalPeriodReviewSchema = z.object({
  periodType: z.enum(["WEEKLY", "MONTHLY"]),
  periodStart: isoDay,
  periodEnd: isoDay,
  whatWentWell: z.string().max(4000, "tooLong").nullish(),
  whatToImprove: z.string().max(4000, "tooLong").nullish(),
  keyLesson: z.string().max(3000, "tooLong").nullish(),
  nextCommitment: z.string().max(2000, "tooLong").nullish(),
}).refine(
  (value) => isValidJournalPeriodRange(value.periodType, value.periodStart, value.periodEnd),
  { message: "invalidPeriodRange", path: ["periodEnd"] },
);


export const journalTemplateSchema = z.object({
  name: z.string().trim().min(1, "required").max(60, "tooLong"),
  description: z.string().max(300, "tooLong").nullish(),
  marketBias: z.string().max(500, "tooLong").nullish(),
  preMarketPlan: z.string().max(4000, "tooLong").nullish(),
  keyLevels: z.string().max(2000, "tooLong").nullish(),
  primaryScenario: z.string().max(4000, "tooLong").nullish(),
  alternateScenario: z.string().max(4000, "tooLong").nullish(),
  invalidationConditions: z.string().max(2000, "tooLong").nullish(),
  maxRiskPercent: z.string().trim()
    .regex(/^(?:[0-9]{1,2}(?:[.][0-9]{1,2})?|100(?:[.]0{1,2})?)$/, "invalidRisk")
    .refine((value) => Number(value) > 0, "invalidRisk")
    .nullish(),
});

export const journalTemplateUpdateSchema = journalTemplateSchema.partial().extend({
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided.",
});


export const journalExportQuerySchema = z.object({
  from: isoDay,
  to: isoDay,
}).refine((value) => {
  const from = new Date(`${value.from}T00:00:00.000Z`);
  const to = new Date(`${value.to}T00:00:00.000Z`);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.toISOString().slice(0, 10) !== value.from ||
    to.toISOString().slice(0, 10) !== value.to
  ) return false;
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  return days >= 0 && days <= 366;
}, { message: "invalidDateRange", path: ["to"] });
