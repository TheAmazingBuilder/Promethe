/**
 * Appearance settings (v2.5 Module 1) — one UserAppearance row per user.
 *
 * Palette semantics: gainColor/lossColor/neutralColor are only meaningful on
 * the "custom" palette — switching away from "custom" clears them so a stale
 * override never leaks into a preset palette.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AppearanceInput } from "@/lib/validations/dashboard";

type AppearanceRow = Prisma.UserAppearanceGetPayload<Record<string, never>>;

export interface KpiDefaultsDTO {
  kpis?: string[];
  showDelta?: boolean;
  showSparkline?: boolean;
}

export interface FocusModeConfigDTO {
  hideAmounts?: boolean;
  blocks?: string[];
}

export interface AppearanceDTO {
  paletteKey: string;
  gainColor: string | null;
  lossColor: string | null;
  neutralColor: string | null;
  density: string;
  chartPaletteKey: string;
  kpiDefaults: KpiDefaultsDTO;
  focusModeConfig: FocusModeConfigDTO | null;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : undefined;
}

function toAppearanceDTO(row: AppearanceRow): AppearanceDTO {
  const kpi = parseJsonObject(row.kpiDefaults) ?? {};
  const focus = parseJsonObject(row.focusModeConfig);
  return {
    paletteKey: row.paletteKey,
    gainColor: row.gainColor,
    lossColor: row.lossColor,
    neutralColor: row.neutralColor,
    density: row.density,
    chartPaletteKey: row.chartPaletteKey,
    kpiDefaults: {
      ...(toStringArray(kpi.kpis) != null ? { kpis: toStringArray(kpi.kpis) } : {}),
      ...(typeof kpi.showDelta === "boolean" ? { showDelta: kpi.showDelta } : {}),
      ...(typeof kpi.showSparkline === "boolean"
        ? { showSparkline: kpi.showSparkline }
        : {}),
    },
    focusModeConfig:
      focus != null
        ? {
            ...(typeof focus.hideAmounts === "boolean"
              ? { hideAmounts: focus.hideAmounts }
              : {}),
            ...(toStringArray(focus.blocks) != null
              ? { blocks: toStringArray(focus.blocks) }
              : {}),
          }
        : null,
  };
}

/** Read the user's appearance row — created with defaults on first read. */
export async function getAppearance(userId: string): Promise<AppearanceDTO> {
  const existing = await db.userAppearance.findUnique({ where: { userId } });
  if (existing) return toAppearanceDTO(existing);
  const created = await db.userAppearance.create({ data: { userId } });
  return toAppearanceDTO(created);
}

/**
 * Upsert the appearance row. Only the provided fields are touched; when the
 * effective palette is not "custom" the color overrides are cleared (null).
 */
export async function putAppearance(
  userId: string,
  input: AppearanceInput
): Promise<AppearanceDTO> {
  const existing = await db.userAppearance.findUnique({ where: { userId } });
  const paletteKey = input.paletteKey ?? existing?.paletteKey ?? "default";
  const keepColors = paletteKey === "custom";

  const row = await db.userAppearance.upsert({
    where: { userId },
    create: {
      userId,
      paletteKey,
      gainColor: keepColors ? (input.gainColor ?? null) : null,
      lossColor: keepColors ? (input.lossColor ?? null) : null,
      neutralColor: keepColors ? (input.neutralColor ?? null) : null,
      density: input.density ?? "COMFORTABLE",
      chartPaletteKey: input.chartPaletteKey ?? "default",
      kpiDefaults:
        input.kpiDefaults != null ? JSON.stringify(input.kpiDefaults) : "{}",
      focusModeConfig:
        input.focusModeConfig != null
          ? JSON.stringify(input.focusModeConfig)
          : null,
    },
    update: {
      ...(input.paletteKey != null ? { paletteKey } : {}),
      // Away from "custom" → the custom colors are meaningless, clear them.
      ...(keepColors
        ? {
            ...(input.gainColor !== undefined ? { gainColor: input.gainColor } : {}),
            ...(input.lossColor !== undefined ? { lossColor: input.lossColor } : {}),
            ...(input.neutralColor !== undefined
              ? { neutralColor: input.neutralColor }
              : {}),
          }
        : { gainColor: null, lossColor: null, neutralColor: null }),
      ...(input.density != null ? { density: input.density } : {}),
      ...(input.chartPaletteKey != null
        ? { chartPaletteKey: input.chartPaletteKey }
        : {}),
      ...(input.kpiDefaults !== undefined
        ? { kpiDefaults: JSON.stringify(input.kpiDefaults ?? {}) }
        : {}),
      ...(input.focusModeConfig !== undefined
        ? {
            focusModeConfig:
              input.focusModeConfig != null
                ? JSON.stringify(input.focusModeConfig)
                : null,
          }
        : {}),
    },
  });
  return toAppearanceDTO(row);
}
