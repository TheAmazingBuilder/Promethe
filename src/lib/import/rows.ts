/**
 * v3 — Row-object parsers shared by CSV (papaparse) and XLSX (SheetJS)
 * inputs: MT5 history, cTrader, TradingView and the generic mapper.
 *
 * A "row" is a header→cell map. Headers are matched through
 * normalizeHeader() so French/English variants work equally.
 */
import type {
  ImportParseWarning,
  NormalizedCashRow,
  NormalizedTradeRow,
  ParseResult,
} from "./types";
import { normalizeHeader } from "./detect";
import {
  isSummaryRow,
  parseDateTime,
  parseDirection,
  parseNumber,
} from "./primitives";
import { eaCostToAppCost } from "@/lib/sync/normalize";

export type HeaderRow = Record<string, string>;
export type RowParser = (rows: HeaderRow[], warnings: ImportParseWarning[]) => Omit<ParseResult, "format" | "formatLabel" | "skippedRows"> & { skippedRows: number };

/** Finds the actual header key in a row for any of the given variants. */
function headerKey(row: HeaderRow, ...variants: string[]): string | null {
  const keys = Object.keys(row);
  // Exact normalized match first.
  for (const variant of variants) {
    const target = normalizeHeader(variant);
    for (const key of keys) {
      if (normalizeHeader(key) === target) return key;
    }
  }
  // Fuzzy pass: "Prix entrée" matches variant "Prix" (startsWith).
  for (const variant of variants) {
    const target = normalizeHeader(variant);
    if (target.length <= 2) continue;
    for (const key of keys) {
      const normalized = normalizeHeader(key);
      if (normalized.startsWith(target) || target.startsWith(normalized)) return key;
    }
  }
  return null;
}

function pick(row: HeaderRow, ...variants: string[]): string | null {
  const key = headerKey(row, ...variants);
  const value = key ? row[key] : null;
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function num(row: HeaderRow, ...variants: string[]): string {
  return parseNumber(pick(row, ...variants)) ?? "0";
}

function cost(row: HeaderRow, ...variants: string[]): string {
  // Broker exports usually print costs NEGATIVE (MT convention) — flip to
  // the app convention, but tolerate already-positive costs from cTrader.
  const raw = pick(row, ...variants);
  if (raw === null) return "0";
  const parsed = parseNumber(raw);
  if (parsed === null) return "0";
  // Heuristic: when the file uses MT signing, negatives dominate. A single
  // positive value in a cost column is treated as an already-flipped cost.
  return parsed.startsWith("-") ? parsed.slice(1) : parsed;
}

function dt(row: HeaderRow, ...variants: string[]): string {
  return parseDateTime(pick(row, ...variants)) ?? "";
}

// ── MT5 History (CSV / XLSX): one row per deal, grouped by position ─────────

interface PositionAccumulator {
  externalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openTime: string;
  openPrice: string;
  closeTime: string;
  closePrice: string;
  volume: string;
  stopLoss?: string;
  takeProfit?: string;
  commission: number;
  swap: number;
  fees: number;
  profit: number;
  magic?: string;
  comment?: string;
}

export const parseMt5Rows: RowParser = (rows, warnings) => {
  const positions = new Map<string, PositionAccumulator>();
  const cash: NormalizedCashRow[] = [];
  let skippedRows = 0;

  for (const [index, row] of rows.entries()) {
    const cells = Object.values(row);
    if (isSummaryRow(cells) || Object.values(row).every((v) => !String(v).trim())) {
      skippedRows++;
      continue;
    }
    const type = (pick(row, "Type", "Type de deal") ?? "").toLowerCase();
    const positionId = pick(row, "Position ID", "Position", "PositionId");

    if (type.startsWith("balance") || type.startsWith("credit")) {
      const amount = num(row, "Profit", "Montant", "Amount");
      const externalId = pick(row, "Deal", "Ticket", "Deal ID") ?? `bal-${index}`;
      cash.push({
        externalId: `MT5:${externalId}`,
        type: type.startsWith("credit") ? "BONUS" : Number(amount) >= 0 ? "DEPOSIT" : "WITHDRAWAL",
        amount,
        time: dt(row, "Time", "Heure", "Open Time"),
        note: pick(row, "Comment", "Commentaire") ?? undefined,
      });
      continue;
    }

    const direction = parseDirection(type);
    if (!direction || !positionId) {
      skippedRows++;
      continue;
    }

    const entryType = (pick(row, "Direction", "Sens") ?? "").toLowerCase();
    const existing = positions.get(positionId);
    if (!existing) {
      positions.set(positionId, {
        externalId: `MT5:${positionId}`,
        symbol: pick(row, "Symbol", "Symbole") ?? "",
        direction,
        openTime: dt(row, "Time", "Heure", "Open Time"),
        openPrice: num(row, "Price", "Prix"),
        closeTime: "",
        closePrice: "",
        volume: num(row, "Volume"),
        stopLoss: parseNumber(pick(row, "S/L", "SL", "Stop Loss")) ?? undefined,
        takeProfit: parseNumber(pick(row, "T/P", "TP", "Take Profit")) ?? undefined,
        commission: Number(cost(row, "Commission")),
        swap: Number(cost(row, "Swap")),
        fees: 0,
        profit: Number(parseNumber(pick(row, "Profit")) ?? "0"),
        magic: pick(row, "Magic") ?? undefined,
        comment: pick(row, "Comment", "Commentaire") ?? undefined,
      });
    } else {
      // Closing deal (or netting add — MT5 CSV "out" rows carry the close).
      if (entryType.startsWith("out") || type.startsWith("buy") || type.startsWith("sell")) {
        existing.closeTime = dt(row, "Time", "Heure", "Close Time") || existing.closeTime;
        existing.closePrice = num(row, "Price", "Prix") || existing.closePrice;
        existing.volume = existing.volume || num(row, "Volume");
        existing.commission += Number(cost(row, "Commission"));
        existing.swap += Number(cost(row, "Swap"));
        existing.profit += Number(parseNumber(pick(row, "Profit")) ?? "0");
      }
    }
  }

  const trades: NormalizedTradeRow[] = [];
  for (const position of positions.values()) {
    if (!position.symbol || !position.closeTime) {
      if (!position.closeTime)
        warnings.push({ code: "OPEN_POSITION_SKIPPED", detail: position.externalId });
      continue;
    }
    trades.push({
      externalId: position.externalId,
      symbol: position.symbol,
      direction: position.direction,
      volume: String(position.volume),
      openTime: position.openTime,
      openPrice: String(position.openPrice),
      closeTime: position.closeTime,
      closePrice: String(position.closePrice),
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      commission: String(position.commission),
      swap: String(position.swap),
      fees: "0",
      profit: String(position.profit),
      magic: position.magic,
      comment: position.comment,
    });
  }

  return { trades, cash, warnings, skippedRows };
};

// ── cTrader: deal rows grouped by Position ID ───────────────────────────────

export const parseCtraderRows: RowParser = (rows, warnings) => {
  const positions = new Map<string, PositionAccumulator>();
  const cash: NormalizedCashRow[] = [];
  let skippedRows = 0;

  for (const [index, row] of rows.entries()) {
    if (isSummaryRow(Object.values(row))) {
      skippedRows++;
      continue;
    }
    const type = (pick(row, "Type") ?? "").toLowerCase();
    const positionId = pick(row, "Position ID", "PositionId", "Position");

    if (type.startsWith("deposit") || type.startsWith("withdrawal") || type.startsWith("credit")) {
      cash.push({
        externalId: `CT:${pick(row, "Deal ID", "DealId", "Deal") ?? index}`,
        type: type.startsWith("credit") ? "BONUS" : type.startsWith("withdrawal") ? "WITHDRAWAL" : "DEPOSIT",
        amount: num(row, "Amount", "Profit", "Deposit Amount"),
        time: dt(row, "Time", "Heure"),
        note: pick(row, "Comment", "Commentaire") ?? undefined,
      });
      continue;
    }

    const direction = parseDirection(type);
    if (!direction || !positionId) {
      skippedRows++;
      continue;
    }

    const existing = positions.get(positionId);
    if (!existing) {
      positions.set(positionId, {
        externalId: `CT:${positionId}`,
        symbol: pick(row, "Symbol", "Symbole") ?? "",
        direction,
        openTime: dt(row, "Time", "Heure"),
        openPrice: num(row, "Price", "Prix"),
        closeTime: "",
        closePrice: "",
        volume: num(row, "Volume", "Quantity", "Qty"),
        stopLoss: parseNumber(pick(row, "Stop Loss", "SL", "S/L")) ?? undefined,
        takeProfit: parseNumber(pick(row, "Take Profit", "TP", "T/P")) ?? undefined,
        commission: Number(cost(row, "Commission")),
        swap: Number(cost(row, "Swap")),
        fees: 0,
        profit: 0,
        comment: pick(row, "Comment", "Commentaire") ?? undefined,
      });
    } else {
      existing.closeTime = dt(row, "Time", "Heure") || existing.closeTime;
      existing.closePrice = num(row, "Price", "Prix") || existing.closePrice;
      existing.commission += Number(cost(row, "Commission"));
      existing.swap += Number(cost(row, "Swap"));
      existing.profit += Number(parseNumber(pick(row, "Profit", "P/L", "PnL")) ?? "0");
    }
  }

  const trades: NormalizedTradeRow[] = [];
  for (const position of positions.values()) {
    if (!position.symbol || !position.closeTime) {
      if (!position.closeTime)
        warnings.push({ code: "OPEN_POSITION_SKIPPED", detail: position.externalId });
      continue;
    }
    trades.push({
      externalId: position.externalId,
      symbol: position.symbol,
      direction: position.direction,
      volume: String(position.volume),
      openTime: position.openTime,
      openPrice: String(position.openPrice),
      closeTime: position.closeTime,
      closePrice: String(position.closePrice),
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      commission: String(position.commission),
      swap: String(position.swap),
      fees: "0",
      profit: String(position.profit),
      comment: position.comment,
    });
  }

  return { trades, cash, warnings, skippedRows };
};

// ── TradingView account history ─────────────────────────────────────────────

export const parseTradingViewRows: RowParser = (rows, warnings) => {
  const trades: NormalizedTradeRow[] = [];
  let skippedRows = 0;

  for (const row of rows) {
    const symbol = pick(row, "Symbol", "symbol");
    const direction = parseDirection(pick(row, "Side", "side"));
    const openTime = dt(row, "Filled", "filled", "Open Time");
    const closeTime = dt(row, "Closed", "closed", "Close Time");
    if (!symbol || !direction || !openTime || !closeTime) {
      skippedRows++;
      continue;
    }
    // Only FILLED round-trips (status closed/filled).
    const status = (pick(row, "Status", "status") ?? "").toLowerCase();
    if (status && !status.includes("fill") && !status.includes("close")) {
      skippedRows++;
      continue;
    }
    const volume = num(row, "Qty", "qty", "Quantity", "Volume");
    const pnl = parseNumber(pick(row, "P/L", "pnl", "PnL", "Profit")) ?? "0";
    trades.push({
      externalId: `TV:${symbol}:${direction}:${openTime}:${volume}`,
      symbol,
      direction,
      volume,
      openTime,
      openPrice: num(row, "Avg Filled Price", "avg_filled_price", "Avg Filled", "Price"),
      closeTime,
      closePrice: num(row, "Closed Price", "closed_price", "Close Price"),
      stopLoss: parseNumber(pick(row, "Stop Price", "stop_price", "Stop")) ?? undefined,
      takeProfit: parseNumber(pick(row, "Limit Price", "limit_price", "Limit")) ?? undefined,
      // TV prints pnl NET of commission in most exports; commission column
      // kept as a cost and pnl treated as net when present alone.
      commission: String(Math.abs(Number(eaCostToAppCost(num(row, "Commission", "commission"))))),
      swap: String(Math.abs(Number(eaCostToAppCost(num(row, "Swap", "swap"))))),
      fees: "0",
      profit: pnl,
    });
  }

  return { trades, cash: [], warnings, skippedRows };
};

// ── Generic CSV mapper (fallback with fuzzy column mapping) ─────────────────

const GENERIC_COLUMN_VARIANTS: Record<string, string[]> = {
  openTime: ["Time", "Date", "Open Time", "Heure", "Date/Time", "Datetime", "Entry Time", "Heure d'ouverture", "Ouverture"],
  timeOfDay: ["Time", "Heure"],
  closeTime: ["Close Time", "Heure de clôture", "Clôture", "Exit Time", "Close Date"],
  closeTimeOfDay: ["Heure sortie", "Heure de clôture", "Close Time"],
  symbol: ["Symbol", "Symbole", "Instrument", "Item", "Pair", "Market", "Élément"],
  direction: ["Side", "Type", "Direction", "Sens", "Buy/Sell", "Achat/Vente"],
  volume: ["Volume", "Qty", "Quantity", "Lots", "Taille", "Size", "Lot"],
  openPrice: ["Price", "Open Price", "Entry Price", "Prix", "Entry", "Open", "Prix d'entrée"],
  closePrice: ["Close Price", "Exit Price", "Prix de sortie", "Exit", "Close", "Prix de clôture"],
  stopLoss: ["SL", "S/L", "Stop Loss", "Stop", "Stop-loss"],
  takeProfit: ["TP", "T/P", "Take Profit", "Target", "T/P"],
  profit: ["Profit", "P/L", "PnL", "P/L Net", "Net P/L", "Résultat", "Gain"],
  commission: ["Commission", "Comm", "Frais", "Fees"],
  swap: ["Swap", "Swaps", "Financement"],
};

export function detectGenericColumns(row: HeaderRow): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [field, variants] of Object.entries(GENERIC_COLUMN_VARIANTS)) {
    const key = headerKey(row, ...variants);
    if (key) mapping[field] = key;
  }
  return mapping;
}

export function makeGenericParser(columns: Record<string, string>): RowParser {
  return (rows, warnings) => {
    const trades: NormalizedTradeRow[] = [];
    let skippedRows = 0;

    for (const [index, row] of rows.entries()) {
      if (isSummaryRow(Object.values(row))) {
        skippedRows++;
        continue;
      }
      const symbol = columns.symbol ? row[columns.symbol]?.trim() : null;
      const direction = parseDirection(columns.direction ? row[columns.direction] : null);
      // Date-only + time-of-day columns combine into one naive date-time.
      const datePart = columns.openTime ? (row[columns.openTime] ?? "").trim() : "";
      const timePart = columns.timeOfDay && columns.timeOfDay !== columns.openTime
        ? (row[columns.timeOfDay] ?? "").trim()
        : "";
      const openTime = parseDateTime(
        timePart && /^\d{4}/.test(datePart) ? `${datePart} ${timePart}` : datePart
      );
      if (!symbol || !direction || !openTime) {
        if (Object.values(row).some((value) => String(value).trim())) {
          warnings.push({ row: index + 2, code: "ROW_MISSING_REQUIRED_FIELDS" });
        }
        skippedRows++;
        continue;
      }
      const volume = parseNumber(columns.volume ? row[columns.volume] : null) ?? "0";
      const closeDatePart = columns.closeTime ? (row[columns.closeTime] ?? "").trim() : "";
      const closeTimePart =
        columns.closeTimeOfDay && columns.closeTimeOfDay !== columns.closeTime
          ? (row[columns.closeTimeOfDay] ?? "").trim()
          : "";
      const closeTime =
        parseDateTime(
          closeTimePart && !/^\d{4}/.test(closeDatePart) && /^\d{1,2}:\d{2}/.test(closeTimePart)
            ? `${datePart.slice(0, 10)} ${closeTimePart}`
            : closeTimePart && closeDatePart
              ? `${closeDatePart} ${closeTimePart}`
              : closeDatePart
        ) ?? openTime;
      trades.push({
        externalId: `GEN:${symbol}:${direction}:${openTime}:${volume}`,
        symbol,
        direction,
        volume,
        openTime,
        openPrice: parseNumber(columns.openPrice ? row[columns.openPrice] : null) ?? "0",
        closeTime,
        closePrice: parseNumber(columns.closePrice ? row[columns.closePrice] : null) ?? "0",
        stopLoss: parseNumber(columns.stopLoss ? row[columns.stopLoss] : null) ?? undefined,
        takeProfit: parseNumber(columns.takeProfit ? row[columns.takeProfit] : null) ?? undefined,
        commission: cost(row, columns.commission ?? ""),
        swap: cost(row, columns.swap ?? ""),
        fees: "0",
        profit: parseNumber(columns.profit ? row[columns.profit] : null) ?? "0",
      });
    }

    return { trades, cash: [], warnings, skippedRows };
  };
}
