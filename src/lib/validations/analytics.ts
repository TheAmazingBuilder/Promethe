/**
 * Zod schemas for the analytics endpoint (v2 Phase 4) — shared by the API
 * route and the client query hook. Client-safe: imports zod only.
 */
import { z } from "zod";

export const ANALYTICS_PERIODS = ["30d", "90d", "ytd", "all"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const analyticsQuerySchema = z.object({
  period: z.enum(ANALYTICS_PERIODS).default("30d"),
  /** Optional account filter (account id). */
  account: z.string().trim().min(1).max(64).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
