/**
 * v3 — Zod schemas for the chunked import payloads (untrusted client input).
 */
import { z } from "zod";

const decimalString = z.string().trim().regex(/^\d+(\.\d+)?$/, "invalidDecimal");
const signedDecimalString = z.string().trim().regex(/^-?\d+(\.\d+)?$/, "invalidDecimal");
const naiveDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "invalidDateTime");

export const importTradeRowSchema = z.object({
  externalId: z.string().trim().min(3).max(120),
  symbol: z.string().trim().min(1).max(40),
  direction: z.enum(["LONG", "SHORT"]),
  volume: decimalString,
  openTime: naiveDateTime,
  openPrice: decimalString,
  closeTime: naiveDateTime,
  closePrice: decimalString,
  stopLoss: decimalString.nullish(),
  takeProfit: decimalString.nullish(),
  commission: signedDecimalString,
  swap: signedDecimalString,
  fees: signedDecimalString,
  profit: signedDecimalString,
  magic: z.string().trim().max(24).nullish(),
  comment: z.string().trim().max(200).nullish(),
});

export const importCashRowSchema = z.object({
  externalId: z.string().trim().min(3).max(120),
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "BONUS"]),
  amount: signedDecimalString,
  time: naiveDateTime,
  note: z.string().trim().max(200).nullish(),
});

export const importChunkSchema = z.object({
  trades: z.array(importTradeRowSchema).max(200),
  cash: z.array(importCashRowSchema).max(200),
});

export const importBatchCreateSchema = z.object({
  accountId: z.string().trim().min(1),
  format: z.enum([
    "MT4_HTML", "MT5_HTML", "MT5_XLSX", "MT5_CSV",
    "CTRADER_CSV", "CTRADER_XLSX", "TRADINGVIEW_CSV", "GENERIC_CSV",
  ]),
  fileName: z.string().trim().min(1).max(200),
  fileHash: z.string().trim().length(64),
  serverTimezone: z.string().trim().min(3).max(60),
  counts: z.object({
    parsed: z.number().int().min(0),
    trades: z.number().int().min(0),
    cash: z.number().int().min(0),
  }),
});

export const importBatchCountsSchema = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  manualSkipped: z.number().int().min(0),
  errors: z.number().int().min(0),
  parsed: z.number().int().min(0),
});
