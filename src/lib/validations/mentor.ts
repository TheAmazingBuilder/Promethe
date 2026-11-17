/**
 * v3 Phase 5 — Zod schemas for mentoring & comments (every route validates).
 *
 * The permission shape mirrors MentorAccess columns and is reused for both
 * invitations (permissionsJson) and live scope edits. Mentors are ALWAYS
 * read-only: no schema ever accepts a write operation on the owner's data —
 * comments are authored under the commenter's own id (TradeComment.authorId).
 */
import { z } from "zod";

/** Public handle: lowercase [a-z0-9_], 3-24 chars (Profile.handle). */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "3–24 characters: a-z, 0-9, _");

/** Fine-grained mentor permissions (scope of the mentee's journal). */
export const mentorPermissionsSchema = z
  .object({
    accountScope: z.enum(["ALL", "LIST"]),
    accountIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    strategyScope: z.enum(["ALL", "LIST"]),
    strategyIds: z.array(z.string().min(1).max(64)).max(100).default([]),
    canViewAmounts: z.boolean().default(true),
    canViewJournal: z.boolean().default(false),
    canViewScreenshots: z.boolean().default(false),
    canViewAnalytics: z.boolean().default(true),
    canComment: z.boolean().default(false),
    /** Optional expiry (ISO datetime); null = no expiry. Normalized to null. */
    expiresAt: z.string().datetime().nullable().default(null),
  })
  .strip();

export type MentorPermissions = z.infer<typeof mentorPermissionsSchema>;

/** POST /api/mentors - invite by email. */
export const mentorInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    permissions: mentorPermissionsSchema,
  })
  .strip();

export type MentorInviteInput = z.infer<typeof mentorInviteSchema>;

/** PATCH /api/mentors/[id] - edit scope / pause / resume. */
export const mentorAccessPatchSchema = z
  .object({
    permissions: mentorPermissionsSchema.optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .refine((v) => v.permissions !== undefined || v.status !== undefined, {
    message: "Nothing to change.",
  });

export type MentorAccessPatch = z.infer<typeof mentorAccessPatchSchema>;

/** POST /api/mentor/invitations/[token] - accept or decline. */
export const invitationActionSchema = z
  .object({
    action: z.enum(["ACCEPT", "DECLINE"]),
  })
  .strip();

/** POST /api/trades/[id]/comments - body + optional parent (one level). */
export const commentCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    parentId: z.string().min(1).max(64).nullable().optional(),
  })
  .strip();

export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

/** PATCH /api/trades/[id]/comments/[commentId] - author-only edit. */
export const commentEditSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
  })
  .strip();

export type CommentEditInput = z.infer<typeof commentEditSchema>;

/** PATCH /api/profile - handle + public display name (mentoring prerequisites). */
export const handlePatchSchema = z
  .object({
    handle: handleSchema,
    publicDisplayName: z.string().trim().min(1).max(60).nullable().optional(),
  })
  .strip();
