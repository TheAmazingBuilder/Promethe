/**
 * Instruments — global presets (read-only) + user-owned customs (v1 phase 7).
 *
 * Presets have userId = null and are seeded once (prisma/seed.ts); customs
 * belong to a user. Deleting a custom instrument is BLOCKED while trades
 * reference it (the FK is SetNull, but history must not silently lose its
 * instrument — an explicit 409 is safer than a mysterious null).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { InstrumentDTO } from "@/lib/trading/dto";
import type {
  instrumentInputSchema,
  instrumentPatchSchema,
} from "@/lib/validations/trade";
import type { z } from "zod";
import { toD } from "@/lib/trading/dec";

type InstrumentRow = Prisma.InstrumentGetPayload<Record<string, never>>;

export function toInstrumentDTO(i: InstrumentRow): InstrumentDTO {
  return {
    id: i.id,
    isPreset: i.userId == null,
    symbol: i.symbol,
    name: i.name,
    assetClass: i.assetClass,
    baseCurrency: i.baseCurrency,
    quoteCurrency: i.quoteCurrency,
    digits: i.digits,
    pipSize: i.pipSize.toString(),
    pointSize: i.pointSize.toString(),
    contractSize: i.contractSize.toString(),
    tickSize: i.tickSize?.toString() ?? null,
    tickValue: i.tickValue?.toString() ?? null,
    isActive: i.isActive,
  };
}

export class InstrumentValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "InstrumentValidationError";
    this.code = code;
    this.status = status;
  }
}

/** Presets (+ the caller's customs when authenticated). */
export async function listInstruments(
  userId: string | null
): Promise<InstrumentDTO[]> {
  const rows = await db.instrument.findMany({
    where: {
      isActive: true,
      OR: [{ userId: null }, ...(userId ? [{ userId }] : [])],
    },
    orderBy: [{ userId: "desc" }, { assetClass: "asc" }, { symbol: "asc" }],
  });
  return rows.map(toInstrumentDTO);
}

export async function createInstrument(
  userId: string,
  input: z.infer<typeof instrumentInputSchema>
): Promise<InstrumentDTO> {
  // A user never overrides a preset or someone else's instrument: customs
  // are keyed by (userId, symbol).
  const existing = await db.instrument.findFirst({
    where: { userId, symbol: input.symbol },
  });
  if (existing) {
    throw new InstrumentValidationError("INSTRUMENT_DUPLICATE");
  }
  // Sanity guard: pipSize must be smaller than 1 (0.0001 … 0.10 for XAUUSD).
  if (toD(input.pipSize).lte(0) || toD(input.pipSize).gte(1)) {
    throw new InstrumentValidationError("INSTRUMENT_PIP_INVALID");
  }
  const created = await db.instrument.create({
    data: {
      userId,
      symbol: input.symbol,
      name: input.name,
      assetClass: input.assetClass,
      baseCurrency: input.baseCurrency ?? null,
      quoteCurrency: input.quoteCurrency,
      digits: input.digits,
      pipSize: input.pipSize,
      pointSize: input.pointSize,
      contractSize: input.contractSize,
      tickSize: input.tickSize ?? null,
      tickValue: input.tickValue ?? null,
      isActive: input.isActive,
    },
  });
  return toInstrumentDTO(created);
}

export async function updateInstrument(
  userId: string,
  id: string,
  patch: z.infer<typeof instrumentPatchSchema>
): Promise<InstrumentDTO | null> {
  const existing = await db.instrument.findFirst({ where: { id, userId } });
  if (!existing) return null;
  if (patch.pipSize != null && (toD(patch.pipSize).lte(0) || toD(patch.pipSize).gte(1))) {
    throw new InstrumentValidationError("INSTRUMENT_PIP_INVALID");
  }
  const updated = await db.instrument.update({
    where: { id: existing.id },
    data: {
      ...(patch.symbol != null ? { symbol: patch.symbol } : {}),
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.assetClass != null ? { assetClass: patch.assetClass } : {}),
      ...(patch.baseCurrency !== undefined
        ? { baseCurrency: patch.baseCurrency ?? null }
        : {}),
      ...(patch.quoteCurrency != null ? { quoteCurrency: patch.quoteCurrency } : {}),
      ...(patch.digits != null ? { digits: patch.digits } : {}),
      ...(patch.pipSize != null ? { pipSize: patch.pipSize } : {}),
      ...(patch.pointSize != null ? { pointSize: patch.pointSize } : {}),
      ...(patch.contractSize != null ? { contractSize: patch.contractSize } : {}),
      ...(patch.tickSize !== undefined
        ? { tickSize: patch.tickSize ?? null }
        : {}),
      ...(patch.tickValue !== undefined
        ? { tickValue: patch.tickValue ?? null }
        : {}),
      ...(patch.isActive != null ? { isActive: patch.isActive } : {}),
    },
  });
  return toInstrumentDTO(updated);
}

export async function deleteInstrument(
  userId: string,
  id: string
): Promise<boolean | "HAS_TRADES"> {
  const existing = await db.instrument.findFirst({ where: { id, userId } });
  if (!existing) return false;
  const hasTrades = await db.trade.findFirst({
    where: { instrumentId: id },
    select: { id: true },
  });
  if (hasTrades) return "HAS_TRADES";
  await db.instrument.delete({ where: { id: existing.id } });
  return true;
}
