import { z } from "zod";
import { TRASH_ENTITIES } from "@/lib/trash/constants";

/**
 * Trash API validation (v2.5 Module 4 §4.6).
 * Entities are a closed enum — every id is ownership-checked server-side.
 */
export const trashEntitySchema = z.enum(TRASH_ENTITIES);

export const trashItemRefSchema = z.object({
  entity: trashEntitySchema,
  id: z.string().min(1).max(64),
});

export const trashListQuerySchema = z.object({
  entity: trashEntitySchema.optional().nullable(),
  search: z.string().trim().max(200).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const trashActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("restore"),
    items: z.array(trashItemRefSchema).min(1).max(500),
  }),
  z.object({
    action: z.literal("delete"),
    items: z.array(trashItemRefSchema).min(1).max(500),
  }),
  z.object({ action: z.literal("empty") }),
]);

export type TrashActionInput = z.infer<typeof trashActionSchema>;
export type TrashItemRefInput = z.infer<typeof trashItemRefSchema>;
