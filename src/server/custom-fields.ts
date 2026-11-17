/**
 * Custom field definitions (v2.5 Module 4 §4.7) - CRUD over
 * CustomFieldDefinition. Max 30 active definitions per user + entity.
 * Keys are slugs derived from the label, unique per (user, entity).
 */
import { db } from "@/lib/db";
import type { CustomFieldDefinitionDTO } from "@/lib/trading/dto";
import type {
  CustomFieldDefinitionInput,
  CustomFieldDefinitionPatch,
} from "@/lib/validations/productivity";

export const MAX_CUSTOM_FIELDS = 30;

export class CustomFieldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomFieldValidationError";
  }
}

function slugify(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "champ";
}

function toDTO(row: {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  options: string | null;
  required: boolean;
  defaultValue: string | null;
  order: number;
  showInTable: boolean;
  showInQuickForm: boolean;
  usableInAnalytics: boolean;
  archivedAt: Date | null;
  createdAt: Date;
}): CustomFieldDefinitionDTO {
  let options: string[] | null = null;
  if (row.options) {
    try {
      const parsed: unknown = JSON.parse(row.options);
      options = Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      options = null;
    }
  }
  let defaultValue: unknown = null;
  if (row.defaultValue) {
    try {
      defaultValue = JSON.parse(row.defaultValue) as unknown;
    } catch {
      defaultValue = row.defaultValue;
    }
  }
  return {
    id: row.id,
    entity: row.entity,
    key: row.key,
    label: row.label,
    type: row.type as CustomFieldDefinitionDTO["type"],
    options,
    required: row.required,
    defaultValue,
    order: row.order,
    showInTable: row.showInTable,
    showInQuickForm: row.showInQuickForm,
    usableInAnalytics: row.usableInAnalytics,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCustomFieldDefinitions(
  userId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<CustomFieldDefinitionDTO[]> {
  const rows = await db.customFieldDefinition.findMany({
    where: {
      userId,
      entity: "TRADES",
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

/** Active (non-archived) definitions, for validation and analytics. */
export async function activeCustomFieldDefinitions(
  userId: string
): Promise<CustomFieldDefinitionDTO[]> {
  return listCustomFieldDefinitions(userId);
}

export async function createCustomFieldDefinition(
  userId: string,
  input: CustomFieldDefinitionInput
): Promise<CustomFieldDefinitionDTO> {
  const active = await db.customFieldDefinition.count({
    where: { userId, entity: "TRADES", archivedAt: null },
  });
  if (active >= MAX_CUSTOM_FIELDS) {
    throw new CustomFieldValidationError("TOO_MANY_CUSTOM_FIELDS");
  }
  const baseKey = slugify(input.label);
  let key = baseKey;
  let suffix = 2;
  while (
    await db.customFieldDefinition.findFirst({
      where: { userId, entity: "TRADES", key },
      select: { id: true },
    })
  ) {
    key = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  const maxOrder = await db.customFieldDefinition.findFirst({
    where: { userId, entity: "TRADES" },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const row = await db.customFieldDefinition.create({
    data: {
      userId,
      entity: "TRADES",
      key,
      label: input.label,
      type: input.type,
      options:
        input.options.length > 0 ? JSON.stringify(input.options) : null,
      required: input.required,
      defaultValue:
        input.defaultValue !== undefined && input.defaultValue !== null
          ? JSON.stringify(input.defaultValue)
          : null,
      order: (maxOrder?.order ?? -1) + 1,
      showInTable: input.showInTable,
      showInQuickForm: input.showInQuickForm,
      usableInAnalytics: input.usableInAnalytics,
    },
  });
  return toDTO(row);
}

export async function updateCustomFieldDefinition(
  userId: string,
  id: string,
  patch: CustomFieldDefinitionPatch
): Promise<CustomFieldDefinitionDTO | null> {
  const existing = await db.customFieldDefinition.findFirst({
    where: { id, userId },
  });
  if (!existing) return null;
  const row = await db.customFieldDefinition.update({
    where: { id },
    data: {
      label: patch.label ?? undefined,
      type: patch.type ?? undefined,
      options:
        patch.options !== undefined
          ? patch.options.length > 0
            ? JSON.stringify(patch.options)
            : null
          : undefined,
      required: patch.required ?? undefined,
      defaultValue:
        patch.defaultValue !== undefined
          ? patch.defaultValue !== null
            ? JSON.stringify(patch.defaultValue)
            : null
          : undefined,
      showInTable: patch.showInTable ?? undefined,
      showInQuickForm: patch.showInQuickForm ?? undefined,
      usableInAnalytics: patch.usableInAnalytics ?? undefined,
      archivedAt:
        patch.archived === undefined
          ? undefined
          : patch.archived
            ? new Date()
            : null,
    },
  });
  return toDTO(row);
}

export async function deleteCustomFieldDefinition(
  userId: string,
  id: string
): Promise<boolean> {
  // Hard delete is safe: trade values are keyed JSON, orphan keys are
  // dropped by the dynamic validator on the next write.
  const deleted = await db.customFieldDefinition.deleteMany({
    where: { id, userId },
  });
  return deleted.count > 0;
}
