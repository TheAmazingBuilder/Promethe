/**
 * Zod schemas for trade comments (every route validates).
 *
 * Owner-only since the Mentors module was removed on 25 Nov 2026: comments
 * are the owner's personal notes on their own trades. Mentions (@handle)
 * and the mentor permission shape used to live here; both are gone.
 */
import { z } from "zod";

/** POST /api/v1/trades/[id]/comments - body + optional parent (one level). */
export const commentCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    parentId: z.string().min(1).max(64).nullable().optional(),
  })
  .strip();

export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

/** PATCH /api/v1/trades/[id]/comments/[commentId] - author-only edit. */
export const commentEditSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
  })
  .strip();

export type CommentEditInput = z.infer<typeof commentEditSchema>;
