/**
 * Validation schemas for the v2.5 Module 4 productivity APIs: global
 * search, bulk trade edits, change history (undo), custom fields,
 * table columns and keyboard shortcuts.
 */
import { z } from "zod";
import { CUSTOM_FIELD_TYPES } from "@/lib/custom-fields/validate";

// ── Global search ────────────────────────────────────────────────────────────

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ── Bulk trades ──────────────────────────────────────────────────────────────

export const bulkTradesSchema = z
  .object({
    tradeIds: z.array(z.string().min(1)).min(1).max(200),
    strategyId: z.string().nullish(),
    accountId: z.string().nullish(),
    addTagIds: z.array(z.string()).max(30).default([]),
    removeTagIds: z.array(z.string()).max(30).default([]),
    /** Soft-delete every selected trade (to the trash). Exclusive with the other ops. */
    deleteToTrash: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.deleteToTrash ||
      v.strategyId !== undefined ||
      v.accountId !== undefined ||
      v.addTagIds.length > 0 ||
      v.removeTagIds.length > 0,
    { message: "no-op" }
  )
  .refine(
    (v) =>
      !v.deleteToTrash ||
      (v.strategyId === undefined &&
        v.accountId === undefined &&
        v.addTagIds.length === 0 &&
        v.removeTagIds.length === 0),
    { message: "delete-exclusive" }
  );

export type BulkTradesInput = z.infer<typeof bulkTradesSchema>;

// ── Custom fields ────────────────────────────────────────────────────────────

export const customFieldDefinitionInputSchema = z.object({
  label: z.string().trim().min(1, "required").max(80),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  required: z.boolean().default(false),
  defaultValue: z.unknown().nullish(),
  showInTable: z.boolean().default(false),
  showInQuickForm: z.boolean().default(false),
  usableInAnalytics: z.boolean().default(false),
});

export type CustomFieldDefinitionInput = z.infer<
  typeof customFieldDefinitionInputSchema
>;

export const customFieldDefinitionPatchSchema =
  customFieldDefinitionInputSchema.partial().extend({
    archived: z.boolean().optional(),
  });

export type CustomFieldDefinitionPatch = z.infer<
  typeof customFieldDefinitionPatchSchema
>;

// ── Table columns ────────────────────────────────────────────────────────────

export const tableColumnsInputSchema = z.object({
  tableKey: z.string().trim().min(1).max(40),
  columnOrder: z.array(z.string().min(1)).max(60),
  columnVisibility: z.record(z.string(), z.boolean()),
  density: z.enum(["compact", "normal", "comfortable"]).nullish(),
});

export type TableColumnsInput = z.infer<typeof tableColumnsInputSchema>;

// ── Shortcuts ────────────────────────────────────────────────────────────────

export const shortcutUpsertSchema = z.object({
  actionId: z.string().trim().min(1).max(60),
  keys: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9?+]+$/i, "invalid"),
});

export type ShortcutUpsertInput = z.infer<typeof shortcutUpsertSchema>;

// ── Saved view patch / duplicate (extends the v1 input) ─────────────────────

export const savedViewPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string().min(1)).max(60).nullish(),
  sort: z
    .array(z.object({ id: z.string().min(1), desc: z.boolean() }))
    .max(10)
    .nullish(),
  grouping: z.record(z.string(), z.unknown()).nullish(),
  isPinned: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().int().min(0).max(100000).optional(),
});

export type SavedViewPatch = z.infer<typeof savedViewPatchSchema>;
