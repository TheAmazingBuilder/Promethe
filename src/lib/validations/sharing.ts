/**
 * v3 — Zod schemas for share links (every route validates its input).
 */
import { z } from "zod";

export const sharePolicySchema = z.object({
  hideAmounts: z.boolean(),
  hideAccountInfo: z.boolean(),
  hideNotes: z.boolean(),
  hideScreenshots: z.boolean(),
  hideStrategyName: z.boolean(),
  hideExactTimes: z.boolean(),
  hidePsychology: z.boolean(),
});

export const shareLinkCreateSchema = z
  .object({
    type: z.literal("TRADE"),
    tradeId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(120),
    mode: z.enum(["SNAPSHOT", "LIVE"]),
    policy: sharePolicySchema,
    expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal(3650)]),
    maxViews: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .strip();

export const shareReportCreateSchema = z
  .object({
    type: z.literal("REPORT"),
    reportPeriod: z.object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      accountId: z.string().min(1).max(64).nullable().optional(),
    }),
    title: z.string().trim().min(1).max(120),
    mode: z.enum(["SNAPSHOT", "LIVE"]),
    policy: sharePolicySchema,
    expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal(3650)]),
    maxViews: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .strip();

export const shareLinkInputSchema = z.discriminatedUnion("type", [
  shareLinkCreateSchema,
  shareReportCreateSchema,
]);

export type ShareLinkInput = z.infer<typeof shareLinkInputSchema>;
