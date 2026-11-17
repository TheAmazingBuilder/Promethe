/**
 * Table column preferences (v2.5 Module 4 §4.8) - one row per
 * (user, tableKey). The client sends the full ordered column list and
 * the visibility map; unknown column ids are kept verbatim so a future
 * app version never wipes a layout it does not know yet.
 */
import { db } from "@/lib/db";
import type { TableColumnPreferenceDTO } from "@/lib/trading/dto";
import type { TableColumnsInput } from "@/lib/validations/productivity";

function parseOrder(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function parseVisibility(raw: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseSizing(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

function parsePinning(raw: string): { left?: string[]; right?: string[] } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as { left?: string[]; right?: string[] };
    }
    return {};
  } catch {
    return {};
  }
}

export async function getTableColumnPreference(
  userId: string,
  tableKey: string
): Promise<TableColumnPreferenceDTO | null> {
  const row = await db.tableColumnPreference.findUnique({
    where: { userId_tableKey: { userId, tableKey } },
  });
  if (!row) return null;
  return {
    tableKey: row.tableKey,
    columnOrder: parseOrder(row.columnOrder),
    columnVisibility: parseVisibility(row.columnVisibility),
    density: row.density,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveTableColumnPreference(
  userId: string,
  input: TableColumnsInput
): Promise<TableColumnPreferenceDTO> {
  const row = await db.tableColumnPreference.upsert({
    where: { userId_tableKey: { userId, tableKey: input.tableKey } },
    create: {
      userId,
      tableKey: input.tableKey,
      columnOrder: JSON.stringify(input.columnOrder),
      columnVisibility: JSON.stringify(input.columnVisibility),
      columnSizing: JSON.stringify({}),
      pinning: JSON.stringify({}),
      density: input.density ?? null,
    },
    update: {
      columnOrder: JSON.stringify(input.columnOrder),
      columnVisibility: JSON.stringify(input.columnVisibility),
      density: input.density ?? undefined,
    },
  });
  return {
    tableKey: row.tableKey,
    columnOrder: parseOrder(row.columnOrder),
    columnVisibility: parseVisibility(row.columnVisibility),
    density: row.density,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { parseOrder, parseVisibility, parseSizing, parsePinning };
