/**
 * Custom fields (v2.5 Module 4 §4.7) - the 9 types of
 * CustomFieldDefinition, the dynamic Zod schema that validates trade values
 * against the user's live definitions, and display formatting.
 *
 * Values live in Trade.customFields as JSON keyed by definition `key`.
 * Server-side, only keys with a live (non-archived) definition survive;
 * unknown keys are dropped silently so stale clients cannot smuggle data.
 */
import { z } from "zod";
import type { CustomFieldDefinitionDTO } from "@/lib/trading/dto";

export const CUSTOM_FIELD_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "DECIMAL",
  "SELECT",
  "MULTI_SELECT",
  "CHECKBOX",
  "DATE",
  "URL",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Zod schema for ONE value of the given definition (optional when not required). */
export function customFieldValueSchema(def: CustomFieldDefinitionDTO): z.ZodTypeAny {
  const options = def.options ?? [];
  let base: z.ZodTypeAny;
  switch (def.type) {
    case "TEXT":
      base = z.string().trim().max(500);
      break;
    case "LONG_TEXT":
      base = z.string().max(5000);
      break;
    case "NUMBER":
      base = z.union([
        z.number().int(),
        z.string().regex(/^-?\d+$/, "invalid").transform((v) => Number.parseInt(v, 10)),
      ]);
      break;
    case "DECIMAL":
      base = z.union([
        z.number(),
        z.string().regex(DECIMAL_RE, "invalid"),
      ]);
      break;
    case "SELECT":
      base =
        options.length > 0
          ? z.enum(options as [string, ...string[]])
          : z.string().trim().max(200);
      break;
    case "MULTI_SELECT":
      base = z.array(z.string()).max(30);
      if (options.length > 0) {
        base = z
          .array(z.enum(options as [string, ...string[]]))
          .max(30);
      }
      break;
    case "CHECKBOX":
      base = z.boolean();
      break;
    case "DATE":
      base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid");
      break;
    case "URL":
      base = z.string().url().max(500);
      break;
    default:
      base = z.unknown();
  }
  return def.required ? base : base.nullish();
}

/**
 * Dynamic schema for a whole customFields record. Unknown keys are stripped
 * (zod object default), missing optional keys stay absent, missing required
 * keys fail. Returns the record in definition order.
 */
export function buildCustomFieldsSchema(defs: CustomFieldDefinitionDTO[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of defs) {
    shape[def.key] = customFieldValueSchema(def);
  }
  return z.object(shape);
}

/** Parse a stored Trade.customFields JSON string into a record (never throws). */
export function parseCustomFields(
  raw: string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Stable JSON for storage: validated values in definition order. */
export function serializeCustomFields(
  values: Record<string, unknown>,
  defs: CustomFieldDefinitionDTO[]
): string | null {
  const parsed = buildCustomFieldsSchema(defs).safeParse(values);
  const clean: Record<string, unknown> =
    parsed.success && parsed.data
      ? (parsed.data as Record<string, unknown>)
      : {};
  const ordered: Record<string, unknown> = {};
  for (const def of defs) {
    if (clean[def.key] !== undefined && clean[def.key] !== null && clean[def.key] !== "") {
      ordered[def.key] = clean[def.key];
    }
  }
  return Object.keys(ordered).length > 0 ? JSON.stringify(ordered) : null;
}

/** Human-readable value for tables and analytics breakdowns. */
export function formatCustomFieldValue(
  def: CustomFieldDefinitionDTO,
  value: unknown
): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

/** Short searchable text for a trade's custom values (folded server-side). */
export function customFieldsSearchText(
  values: Record<string, unknown>,
  defs: CustomFieldDefinitionDTO[]
): string {
  return defs
    .map((d) => {
      const v = values[d.key];
      if (v === null || v === undefined || v === "") return "";
      return Array.isArray(v) ? v.map(String).join(" ") : String(v);
    })
    .filter(Boolean)
    .join(" ");
}
