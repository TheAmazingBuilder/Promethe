/**
 * v3 — Zod schemas for the EA ingest contract (schemaVersion 1).
 *
 * Shared source of truth between /api/ingest/mt validation and the
 * simulate-ea script. All numerics are decimal STRINGS; times are unix
 * seconds in broker server time. Client-safe (zod only).
 */
import { z } from "zod";
import { INGEST_SCHEMA_VERSION } from "@/lib/sync/types";

// ── Primitives ───────────────────────────────────────────────────────────────

const decimalString = z.string().trim().regex(/^\d+(\.\d+)?$/, "invalidDecimal");
const signedDecimalString = z.string().trim().regex(/^-?\d+(\.\d+)?$/, "invalidDecimal");
const optionalSignedDecimal = signedDecimalString.nullish();
const unixSeconds = z.number().int().nonnegative();
const eventId = z.string().trim().min(8).max(200);
const nonEmpty = z.string().trim().min(1).max(200);

const symbolSpecSchema = z.object({
  digits: decimalString,
  point: decimalString,
  tickSize: decimalString,
  tickValue: decimalString,
  contractSize: decimalString,
});

const mtEventBase = {
  eventId,
  time: unixSeconds,
};

// ── Event schemas ────────────────────────────────────────────────────────────

const heartbeatEvent = z.object({
  ...mtEventBase,
  type: z.literal("HEARTBEAT"),
  balance: signedDecimalString,
  equity: signedDecimalString,
  margin: signedDecimalString.nullish(),
  openPositions: z.number().int().min(0),
});

const positionOpenedEvent = z.object({
  ...mtEventBase,
  type: z.literal("POSITION_OPENED"),
  symbol: nonEmpty,
  symbolSpec: symbolSpecSchema.nullish(),
  positionId: nonEmpty,
  ticket: nonEmpty,
  direction: z.enum(["LONG", "SHORT"]),
  volume: decimalString,
  openTime: unixSeconds,
  openPrice: decimalString,
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  magic: z.string().trim().max(24).nullish(),
  comment: z.string().trim().max(200).nullish(),
});

const positionModifiedEvent = z.object({
  ...mtEventBase,
  type: z.literal("POSITION_MODIFIED"),
  positionId: nonEmpty,
  symbol: nonEmpty.nullish(),
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  volume: decimalString.nullish(),
});

const positionPartialCloseEvent = z.object({
  ...mtEventBase,
  type: z.literal("POSITION_PARTIAL_CLOSE"),
  positionId: nonEmpty,
  closedVolume: decimalString,
  closeTime: unixSeconds,
  closePrice: decimalString,
  profit: signedDecimalString,
  commission: optionalSignedDecimal,
  swap: optionalSignedDecimal,
});

const positionClosedEvent = z.object({
  ...mtEventBase,
  type: z.literal("POSITION_CLOSED"),
  symbol: nonEmpty.nullish(),
  symbolSpec: symbolSpecSchema.nullish(),
  positionId: nonEmpty,
  ticket: nonEmpty,
  direction: z.enum(["LONG", "SHORT"]).nullish(),
  volume: decimalString,
  openTime: unixSeconds.nullish(),
  openPrice: decimalString.nullish(),
  closeTime: unixSeconds,
  closePrice: decimalString,
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  commission: optionalSignedDecimal,
  swap: optionalSignedDecimal,
  fees: optionalSignedDecimal,
  profit: signedDecimalString,
  magic: z.string().trim().max(24).nullish(),
  comment: z.string().trim().max(200).nullish(),
  mfePrice: decimalString.nullish(),
  maePrice: decimalString.nullish(),
  mfeMaeComplete: z.boolean().nullish(),
});

const balanceOperationEvent = z.object({
  ...mtEventBase,
  type: z.literal("BALANCE_OPERATION"),
  amount: signedDecimalString,
  kind: z.enum(["DEPOSIT", "WITHDRAWAL", "CREDIT"]).nullish(),
  comment: z.string().trim().max(200).nullish(),
});

const historyTrade = z.object({
  positionId: nonEmpty,
  ticket: nonEmpty,
  symbol: nonEmpty,
  symbolSpec: symbolSpecSchema.nullish(),
  direction: z.enum(["LONG", "SHORT"]),
  volume: decimalString,
  openTime: unixSeconds,
  openPrice: decimalString,
  closeTime: unixSeconds,
  closePrice: decimalString,
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  commission: optionalSignedDecimal,
  swap: optionalSignedDecimal,
  fees: optionalSignedDecimal,
  profit: signedDecimalString,
  magic: z.string().trim().max(24).nullish(),
  comment: z.string().trim().max(200).nullish(),
  mfePrice: decimalString.nullish(),
  maePrice: decimalString.nullish(),
  mfeMaeComplete: z.boolean().nullish(),
});

const historyBatchEvent = z.object({
  ...mtEventBase,
  type: z.literal("HISTORY_BATCH"),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(1),
  trades: z.array(historyTrade).max(100),
});

const pendingOrderEvent = z.object({
  ...mtEventBase,
  type: z.enum(["ORDER_PLACED", "ORDER_CANCELLED"]),
  ticket: nonEmpty,
  symbol: nonEmpty,
  direction: z.enum(["LONG", "SHORT"]),
  orderType: z.enum(["LIMIT", "STOP", "STOP_LIMIT"]),
  volume: decimalString,
  price: decimalString.nullish(),
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  cancelTime: unixSeconds.nullish(),
});

export const mtEventSchema = z.discriminatedUnion("type", [
  heartbeatEvent,
  positionOpenedEvent,
  positionModifiedEvent,
  positionPartialCloseEvent,
  positionClosedEvent,
  balanceOperationEvent,
  historyBatchEvent,
  pendingOrderEvent,
]);

// ── Envelope ─────────────────────────────────────────────────────────────────

export const mtIngestPayloadSchema = z.object({
  schemaVersion: z.literal(INGEST_SCHEMA_VERSION),
  platform: z.enum(["MT4", "MT5"]),
  eaVersion: z.string().trim().min(1).max(24),
  server: nonEmpty,
  login: nonEmpty,
  currency: z.string().trim().length(3).nullish(),
  leverage: decimalString.nullish(),
  serverGmtOffsetSeconds: z.number().int().min(-13 * 3600).max(15 * 3600),
  sentAt: unixSeconds,
  events: z.array(mtEventSchema).min(1).max(200),
});

export type MtIngestPayloadInput = z.infer<typeof mtIngestPayloadSchema>;

// ── Broker connection management (owner API) ────────────────────────────────

export const brokerConnectionCreateSchema = z.object({
  accountId: nonEmpty,
  platform: z.enum(["MT4", "MT5"]),
  label: z.string().trim().min(1).max(60),
});

export const brokerConnectionUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  autoMergeEnabled: z.boolean().optional(),
  historyBackfillFrom: z.string().datetime().nullish(),
  /** Owner-initiated binding reset after a MISMATCH (rebind a new terminal). */
  resetBinding: z.boolean().optional(),
});

export const symbolMappingUpsertSchema = z.object({
  brokerSymbol: nonEmpty,
  instrumentId: nonEmpty,
  /** Optional pip-size override for the target instrument. */
  pipSize: decimalString.nullish(),
});

export const magicMappingSchema = z.object({
  magicNumber: z.string().trim().regex(/^\d{1,10}$/),
  strategyId: nonEmpty,
  connectionId: nonEmpty.nullish(),
});
