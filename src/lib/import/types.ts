/**
 * v3 — Import file contracts (client-safe, shared by browser parsers, Web
 * Worker and the chunked import server).
 *
 * Parsers NEVER convert timezones: they return NAIVE local date-time strings
 * exactly as printed in the file; the server converts to UTC using the
 * timezone the user declared for the batch (v3 §4.2). All numerics stay
 * strings for exact decimals. Money follows the app convention: costs
 * POSITIVE (the CSV/HTML parsers flip broker negatives at parse time).
 */

export type ImportFormat =
  | "MT4_HTML"
  | "MT5_HTML"
  | "MT5_XLSX"
  | "MT5_CSV"
  | "CTRADER_CSV"
  | "CTRADER_XLSX"
  | "TRADINGVIEW_CSV"
  | "GENERIC_CSV";

/** A closed (or single-row open→close) broker trade, normalized. */
export interface NormalizedTradeRow {
  /** Broker position/ticket id — import dedupe key. */
  externalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  volume: string;
  /** NAIVE local date-time "YYYY-MM-DD HH:mm:ss" as printed in the file. */
  openTime: string;
  openPrice: string;
  closeTime: string;
  closePrice: string;
  stopLoss?: string;
  takeProfit?: string;
  /** App signing: positive = cost. */
  commission: string;
  swap: string;
  fees: string;
  /** Gross profit in the account currency (broker truth). */
  profit: string;
  magic?: string;
  comment?: string;
}

export interface NormalizedCashRow {
  externalId: string;
  type: "DEPOSIT" | "WITHDRAWAL" | "BONUS";
  /** App signing: + deposit, − withdrawal. */
  amount: string;
  /** NAIVE local date-time. */
  time: string;
  note?: string;
}

export interface ImportParseWarning {
  row?: number;
  code: string;
  detail?: string;
}

export interface ParseResult {
  format: ImportFormat;
  /** Detected human label, e.g. "MT4 Detailed Statement". */
  formatLabel: string;
  trades: NormalizedTradeRow[];
  cash: NormalizedCashRow[];
  warnings: ImportParseWarning[];
  /** Column mapping used (generic CSV) — for the preview UI. */
  columns?: Record<string, string>;
  /** Rows skipped as summary/aggregate lines (count only). */
  skippedRows: number;
}

export interface DetectedFormat {
  format: ImportFormat;
  label: string;
  confidence: "certain" | "likely";
  reason: string;
}

export interface ImportFileContent {
  /** File name (display). */
  fileName: string;
  /** Lower-cased extension without dot. */
  extension: string;
  /** Decoded text (CSV/HTML). Empty for XLSX (parsed from the buffer). */
  text?: string;
  /** Raw bytes (XLSX). */
  bytes?: Uint8Array;
}
