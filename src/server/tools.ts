/**
 * v2.5 Module 5 - trading tools: server persistence (Supabase/Postgres).
 *
 * Replaces the former localStorage store (src/lib/tools/store.ts, deleted):
 * ToolScenario, FxRate, MarketSessionSetting, ExitPlan and
 * ExposureAlertSetting are Prisma models, one row per user, ownership
 * enforced on every query (userId scoping, same pattern as
 * src/server/custom-fields.ts).
 *
 * Graceful degradation: when the tables do not exist yet in the database
 * (the user has not run `npx prisma db push` on their PC), Prisma throws
 * P2021. `guardToolsTable` converts it to ToolsTablesMissingError, which
 * the API layer maps to 503 TOOLS_TABLES_MISSING so the UI can show a
 * clean "run the migration" state instead of crashing.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  ExitPlanDTO,
  ExposureAlertSettingDTO,
  FxRateDTO,
  MarketSessionSettingDTO,
  ToolScenarioDTO,
} from "@/lib/trading/dto";
import type { FxRateInput as CalcFxRateInput } from "@/lib/tools/fx";
import {
  DEFAULT_DETECTION_SETTINGS,
  detectSessionFromSettings,
  mergeSessionSettings,
  type MarketSessionSettingEntry,
} from "@/lib/tools/market-hours";
import { parseFxCsv } from "@/lib/tools/fx";
import { validateExitPlan } from "@/lib/tools/exit-plans";
import type { ExitPlanTier } from "@/lib/tools/types";
import type { TradingSession } from "@/lib/trading/types";
import type {
  ExitPlanInput,
  ExitPlanPatch,
  ExposureSettingsInput,
  FxRateInput,
  FxRatePatch,
  MarketSessionSettingInput,
  MarketSessionSettingPatch,
  ToolScenarioInput,
  ToolScenarioPatch,
} from "@/lib/validations/tools";

export class ToolsValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "ToolsValidationError";
    this.code = code;
    this.status = status;
  }
}

/** Thrown when a tools table is missing (migration not run yet). */
export class ToolsTablesMissingError extends Error {
  readonly code = "TOOLS_TABLES_MISSING";
  readonly status = 503;
  constructor() {
    super("TOOLS_TABLES_MISSING");
    this.name = "ToolsTablesMissingError";
  }
}

function isMissingTableError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  );
}

/** Run a tools query, converting a missing-table error (P2021) into a
 * typed 503 so routes and the UI can degrade gracefully. */
async function guardToolsTable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isMissingTableError(error)) throw new ToolsTablesMissingError();
    throw error;
  }
}

// ── DTO mapping ──────────────────────────────────────────────────────────────

function parseJsonArray(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter((v): v is number => typeof v === "number")
      : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseTiers(value: string): ExitPlanTier[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ExitPlanTier[]) : [];
  } catch {
    return [];
  }
}

type ToolScenarioRow = {
  id: string;
  name: string;
  kind: string;
  payloadJson: string;
  createdAt: Date;
};

function toScenarioDTO(row: ToolScenarioRow): ToolScenarioDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    payload: parseJsonRecord(row.payloadJson),
    createdAt: row.createdAt.toISOString(),
  };
}

type FxRateRow = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: Prisma.Decimal;
  source: string;
  rateDate: Date;
  createdAt: Date;
};

function toFxRateDTO(row: FxRateRow): FxRateDTO {
  return {
    id: row.id,
    base: row.baseCurrency,
    quote: row.quoteCurrency,
    rate: row.rate.toString(),
    source: row.source,
    date: row.rateDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}

type MarketSessionRow = {
  id: string;
  name: string;
  kind: string;
  timezone: string;
  openTime: string;
  closeTime: string;
  activeDays: string;
  isEnabled: boolean;
  sortOrder: number;
};

function toSessionDTO(row: MarketSessionRow): MarketSessionSettingDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    timezone: row.timezone,
    openTime: row.openTime,
    closeTime: row.closeTime,
    activeDays: parseJsonArray(row.activeDays),
    enabled: row.isEnabled,
    sortOrder: row.sortOrder,
  };
}

function toSessionEntry(row: MarketSessionRow): MarketSessionSettingEntry {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "DETECTION" ? "DETECTION" : "DISPLAY",
    timezone: row.timezone,
    openTime: row.openTime,
    closeTime: row.closeTime,
    activeDays: parseJsonArray(row.activeDays),
    enabled: row.isEnabled,
    sortOrder: row.sortOrder,
  };
}

type ExitPlanRow = {
  id: string;
  name: string;
  tiersJson: string;
  breakevenAfterTier: number | null;
  trailingAfterTier: number | null;
  notes: string | null;
  createdAt: Date;
};

function toExitPlanDTO(row: ExitPlanRow): ExitPlanDTO {
  return {
    id: row.id,
    name: row.name,
    tiers: parseTiers(row.tiersJson),
    breakevenAfterTier: row.breakevenAfterTier,
    trailingAfterTier: row.trailingAfterTier,
    notes: row.notes ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

type ExposureRow = {
  id: string;
  enabled: boolean;
  duplicationThresholdPercent: Prisma.Decimal;
  maxCurrencyExposurePercent: Prisma.Decimal;
};

function toExposureDTO(row: ExposureRow): ExposureAlertSettingDTO {
  return {
    id: row.id,
    enabled: row.enabled,
    duplicationThresholdPercent: row.duplicationThresholdPercent.toString(),
    maxCurrencyExposurePercent: row.maxCurrencyExposurePercent.toString(),
  };
}

// ── Tool scenarios ───────────────────────────────────────────────────────────

export async function listToolScenarios(
  userId: string,
  kind?: string
): Promise<ToolScenarioDTO[]> {
  const rows = await guardToolsTable(() =>
    db.toolScenario.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
    })
  );
  return rows.map(toScenarioDTO);
}

export async function createToolScenario(
  userId: string,
  input: ToolScenarioInput
): Promise<ToolScenarioDTO> {
  const row = await guardToolsTable(() =>
    db.toolScenario.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind,
        payloadJson: JSON.stringify(input.payload),
      },
    })
  );
  return toScenarioDTO(row);
}

export async function updateToolScenario(
  userId: string,
  id: string,
  patch: ToolScenarioPatch
): Promise<ToolScenarioDTO | null> {
  const existing = await guardToolsTable(() =>
    db.toolScenario.findFirst({ where: { id, userId } })
  );
  if (!existing) return null;
  const row = await guardToolsTable(() =>
    db.toolScenario.update({
      where: { id },
      data: {
        name: patch.name ?? undefined,
        payloadJson:
          patch.payload !== undefined
            ? JSON.stringify(patch.payload)
            : undefined,
      },
    })
  );
  return toScenarioDTO(row);
}

export async function deleteToolScenario(
  userId: string,
  id: string
): Promise<boolean> {
  const deleted = await guardToolsTable(() =>
    db.toolScenario.deleteMany({ where: { id, userId } })
  );
  return deleted.count > 0;
}

// ── FX rates ─────────────────────────────────────────────────────────────────

export async function listFxRates(userId: string): Promise<FxRateDTO[]> {
  const rows = await guardToolsTable(() =>
    db.fxRate.findMany({
      where: { userId },
      orderBy: [{ baseCurrency: "asc" }, { quoteCurrency: "asc" }],
    })
  );
  return rows.map(toFxRateDTO);
}

/** Rates in calcPnL shape. Best-effort: [] when the table is missing. */
export async function listFxRateInputs(userId: string): Promise<CalcFxRateInput[]> {
  try {
    const rates = await listFxRates(userId);
    return rates.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate }));
  } catch (error) {
    if (error instanceof ToolsTablesMissingError) return [];
    throw error;
  }
}

function rateDateOf(input: { date?: string | null }): Date {
  if (input.date) {
    const d = new Date(input.date.length <= 10 ? `${input.date}T00:00:00.000Z` : input.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Upsert by (user, base, quote): re-adding a pair updates its rate. */
export async function upsertFxRate(
  userId: string,
  input: FxRateInput
): Promise<FxRateDTO> {
  if (input.base === input.quote) {
    throw new ToolsValidationError("FX_RATE_SAME_CURRENCY");
  }
  const row = await guardToolsTable(() =>
    db.fxRate.upsert({
      where: {
        userId_baseCurrency_quoteCurrency: {
          userId,
          baseCurrency: input.base,
          quoteCurrency: input.quote,
        },
      },
      create: {
        userId,
        baseCurrency: input.base,
        quoteCurrency: input.quote,
        rate: input.rate,
        source: input.source,
        rateDate: rateDateOf(input),
      },
      update: {
        rate: input.rate,
        source: input.source,
        rateDate: rateDateOf(input),
      },
    })
  );
  return toFxRateDTO(row);
}

export async function updateFxRate(
  userId: string,
  id: string,
  patch: FxRatePatch
): Promise<FxRateDTO | null> {
  const existing = await guardToolsTable(() =>
    db.fxRate.findFirst({ where: { id, userId } })
  );
  if (!existing) return null;
  const base = patch.base ?? existing.baseCurrency;
  const quote = patch.quote ?? existing.quoteCurrency;
  if (base === quote) {
    throw new ToolsValidationError("FX_RATE_SAME_CURRENCY");
  }
  try {
    const row = await guardToolsTable(() =>
      db.fxRate.update({
        where: { id },
        data: {
          baseCurrency: base,
          quoteCurrency: quote,
          rate: patch.rate ?? undefined,
          rateDate: patch.date ? rateDateOf(patch) : undefined,
        },
      })
    );
    return toFxRateDTO(row);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ToolsValidationError("FX_RATE_DUPLICATE");
    }
    throw error;
  }
}

export async function deleteFxRate(userId: string, id: string): Promise<boolean> {
  const deleted = await guardToolsTable(() =>
    db.fxRate.deleteMany({ where: { id, userId } })
  );
  return deleted.count > 0;
}

/** Server-side CSV import: `base,quote,taux` or `paire,taux` per line. */
export async function importFxRatesCsv(
  userId: string,
  csv: string
): Promise<{ imported: number; errors: string[] }> {
  const { rates, errors } = parseFxCsv(csv);
  let imported = 0;
  for (const r of rates) {
    await upsertFxRate(userId, {
      base: r.base,
      quote: r.quote,
      rate: r.rate,
      source: "CSV",
      date: r.date,
    });
    imported += 1;
  }
  return { imported, errors };
}

// ── Market session settings ──────────────────────────────────────────────────

export async function listMarketSessionSettings(
  userId: string,
  kind?: string
): Promise<MarketSessionSettingDTO[]> {
  const rows = await guardToolsTable(() =>
    db.marketSessionSetting.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
  );
  return rows.map(toSessionDTO);
}

export async function createMarketSessionSetting(
  userId: string,
  input: MarketSessionSettingInput
): Promise<MarketSessionSettingDTO> {
  const row = await guardToolsTable(() =>
    db.marketSessionSetting.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind,
        timezone: input.timezone,
        openTime: input.openTime,
        closeTime: input.closeTime,
        activeDays: JSON.stringify(input.activeDays),
        isEnabled: input.enabled,
        sortOrder: input.sortOrder,
      },
    })
  );
  return toSessionDTO(row);
}

export async function updateMarketSessionSetting(
  userId: string,
  id: string,
  patch: MarketSessionSettingPatch
): Promise<MarketSessionSettingDTO | null> {
  const existing = await guardToolsTable(() =>
    db.marketSessionSetting.findFirst({ where: { id, userId } })
  );
  if (!existing) return null;
  const row = await guardToolsTable(() =>
    db.marketSessionSetting.update({
      where: { id },
      data: {
        name: patch.name ?? undefined,
        timezone: patch.timezone ?? undefined,
        openTime: patch.openTime ?? undefined,
        closeTime: patch.closeTime ?? undefined,
        activeDays:
          patch.activeDays !== undefined
            ? JSON.stringify(patch.activeDays)
            : undefined,
        isEnabled: patch.enabled ?? undefined,
        sortOrder: patch.sortOrder ?? undefined,
      },
    })
  );
  return toSessionDTO(row);
}

export async function deleteMarketSessionSetting(
  userId: string,
  id: string
): Promise<boolean> {
  const deleted = await guardToolsTable(() =>
    db.marketSessionSetting.deleteMany({ where: { id, userId } })
  );
  return deleted.count > 0;
}

/** Delete all of the user's session rows: the code defaults apply again. */
export async function resetMarketSessionSettings(userId: string): Promise<number> {
  const deleted = await guardToolsTable(() =>
    db.marketSessionSetting.deleteMany({ where: { userId } })
  );
  return deleted.count;
}

// ── Exit plans ───────────────────────────────────────────────────────────────

export async function listExitPlans(userId: string): Promise<ExitPlanDTO[]> {
  const rows = await guardToolsTable(() =>
    db.exitPlan.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })
  );
  return rows.map(toExitPlanDTO);
}

function assertValidPlan(
  tiers: ExitPlanTier[],
  breakevenAfterTier: number | null,
  trailingAfterTier: number | null
): void {
  if (validateExitPlan(tiers, breakevenAfterTier, trailingAfterTier) !== null) {
    throw new ToolsValidationError("EXIT_PLAN_INVALID");
  }
}

export async function createExitPlan(
  userId: string,
  input: ExitPlanInput
): Promise<ExitPlanDTO> {
  assertValidPlan(input.tiers, input.breakevenAfterTier, input.trailingAfterTier);
  const row = await guardToolsTable(() =>
    db.exitPlan.create({
      data: {
        userId,
        name: input.name,
        tiersJson: JSON.stringify(input.tiers),
        breakevenAfterTier: input.breakevenAfterTier,
        trailingAfterTier: input.trailingAfterTier,
        notes: input.notes === "" ? null : input.notes,
      },
    })
  );
  return toExitPlanDTO(row);
}

export async function updateExitPlan(
  userId: string,
  id: string,
  patch: ExitPlanPatch
): Promise<ExitPlanDTO | null> {
  const existing = await guardToolsTable(() =>
    db.exitPlan.findFirst({ where: { id, userId } })
  );
  if (!existing) return null;
  const nextTiers = patch.tiers ?? parseTiers(existing.tiersJson);
  const nextBreakeven =
    patch.breakevenAfterTier !== undefined
      ? patch.breakevenAfterTier
      : existing.breakevenAfterTier;
  const nextTrailing =
    patch.trailingAfterTier !== undefined
      ? patch.trailingAfterTier
      : existing.trailingAfterTier;
  assertValidPlan(nextTiers, nextBreakeven, nextTrailing);
  const row = await guardToolsTable(() =>
    db.exitPlan.update({
      where: { id },
      data: {
        name: patch.name ?? undefined,
        tiersJson:
          patch.tiers !== undefined ? JSON.stringify(patch.tiers) : undefined,
        breakevenAfterTier:
          patch.breakevenAfterTier !== undefined
            ? patch.breakevenAfterTier
            : undefined,
        trailingAfterTier:
          patch.trailingAfterTier !== undefined
            ? patch.trailingAfterTier
            : undefined,
        notes:
          patch.notes !== undefined
            ? patch.notes === ""
              ? null
              : patch.notes
            : undefined,
      },
    })
  );
  return toExitPlanDTO(row);
}

export async function deleteExitPlan(userId: string, id: string): Promise<boolean> {
  const deleted = await guardToolsTable(() =>
    db.exitPlan.deleteMany({ where: { id, userId } })
  );
  return deleted.count > 0;
}

/** Ownership check for Trade.exitPlanId (null = no plan). */
export async function resolveExitPlan(
  userId: string,
  exitPlanId: string | null
): Promise<void> {
  if (!exitPlanId) return;
  const plan = await guardToolsTable(() =>
    db.exitPlan.findFirst({ where: { id: exitPlanId, userId }, select: { id: true } })
  );
  if (!plan) throw new ToolsValidationError("EXIT_PLAN_NOT_FOUND");
}

// ── Exposure alert settings (singleton) ──────────────────────────────────────

export async function getExposureAlertSetting(
  userId: string
): Promise<ExposureAlertSettingDTO | null> {
  const row = await guardToolsTable(() =>
    db.exposureAlertSetting.findUnique({ where: { userId } })
  );
  return row ? toExposureDTO(row) : null;
}

export async function upsertExposureAlertSetting(
  userId: string,
  input: ExposureSettingsInput
): Promise<ExposureAlertSettingDTO> {
  const row = await guardToolsTable(() =>
    db.exposureAlertSetting.upsert({
      where: { userId },
      create: {
        userId,
        enabled: input.enabled,
        duplicationThresholdPercent: input.duplicationThresholdPercent,
        maxCurrencyExposurePercent: input.maxCurrencyExposurePercent,
      },
      update: {
        enabled: input.enabled,
        duplicationThresholdPercent: input.duplicationThresholdPercent,
        maxCurrencyExposurePercent: input.maxCurrencyExposurePercent,
      },
    })
  );
  return toExposureDTO(row);
}

// ── Server-side session detection + FX for calcPnL ───────────────────────────

/**
 * DETECTION settings merged over the legacy UTC defaults. Best-effort:
 * defaults when the user has no rows, or when the table is missing.
 */
export async function getDetectionSettings(
  userId: string
): Promise<MarketSessionSettingEntry[]> {
  try {
    const rows = await guardToolsTable(() =>
      db.marketSessionSetting.findMany({
        where: { userId, kind: "DETECTION" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })
    );
    return mergeSessionSettings(rows.map(toSessionEntry));
  } catch (error) {
    if (error instanceof ToolsTablesMissingError) {
      return DEFAULT_DETECTION_SETTINGS;
    }
    throw error;
  }
}

/** Session of a date using the user's DETECTION settings (defaults fallback). */
export async function detectSessionForUser(
  userId: string,
  date: Date
): Promise<TradingSession> {
  const settings = await getDetectionSettings(userId);
  return detectSessionFromSettings(date, settings);
}
