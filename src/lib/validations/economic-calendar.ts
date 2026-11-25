import { z } from "zod";

const IMPACT_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;
const CATEGORY_VALUES = [
  "NFP",
  "CPI",
  "FOMC",
  "PPI",
  "GDP",
  "PMI",
  "RETAIL_SALES",
  "RATE_DECISION",
  "SPEECH",
  "OTHER",
] as const;

export const manualEconomicEventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code."),
  country: z.string().trim().toUpperCase().min(2).max(3).optional(),
  impact: z.enum(IMPACT_VALUES),
  category: z.enum(CATEGORY_VALUES),
  /** Scheduled instant, ISO string (UTC). */
  scheduledAt: z.string().datetime({ offset: true }),
  actual: z.string().trim().max(64).optional(),
  forecast: z.string().trim().max(64).optional(),
  previous: z.string().trim().max(64).optional(),
  unit: z.string().trim().max(32).optional(),
});

export type ManualEconomicEventInput = z.infer<typeof manualEconomicEventInputSchema>;

export const watchlistPrefsInputSchema = z.object({
  currencies: z.array(z.string().trim().toUpperCase().min(3).max(3)).max(20),
  categories: z.array(z.enum(CATEGORY_VALUES)).max(20),
  minImpact: z.enum(IMPACT_VALUES),
  alertsEnabled: z.boolean(),
  alertMinutesBefore: z.number().int().min(5).max(1440),
});

export type WatchlistPrefsInput = z.infer<typeof watchlistPrefsInputSchema>;

export const economicCalendarFiltersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currencies: z.string().optional(),
  countries: z.string().optional(),
  impacts: z.string().optional(),
  categories: z.string().optional(),
  sources: z.string().optional(),
  watchlistOnly: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type EconomicCalendarFilters = z.infer<typeof economicCalendarFiltersSchema>;

export const eventTradeLinkInputSchema = z.object({
  tradeId: z.string().trim().min(1).max(64),
  eventId: z.string().trim().min(1).max(64),
});

export type EventTradeLinkInput = z.infer<typeof eventTradeLinkInputSchema>;
