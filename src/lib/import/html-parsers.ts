/**
 * v3 — MT4 "Detailed Statement" and MT5 "Trade History Report" HTML parsers.
 *
 * MetaTrader emits regular, machine-generated tables — extracted with the
 * dependency-free tokenizer in primitives.ts (no DOMParser needed, so the
 * same code runs in the Web Worker, the browser and Node tests).
 *
 * Duplicate header names (MT4 prints two "Price" columns) are resolved by
 * claiming indexes: each resolved column is excluded from later lookups.
 */
import type {
  ImportParseWarning,
  NormalizedCashRow,
  NormalizedTradeRow,
  ParseResult,
} from "./types";
import { normalizeHeader } from "./detect";
import {
  extractHtmlTables,
  isSummaryRow,
  parseDateTime,
  parseDirection,
  parseNumber,
} from "./primitives";
import { parseMt4ChainComment } from "@/lib/sync/normalize";

/** Column index resolution with claimed indexes (duplicate headers). */
function columnIndex(
  headerCells: string[],
  variants: string[],
  used: Set<number>
): number {
  const normalized = headerCells.map(normalizeHeader);
  for (const variant of variants) {
    const target = normalizeHeader(variant);
    const index = normalized.findIndex((cell, i) => cell === target && !used.has(i));
    if (index >= 0) {
      used.add(index);
      return index;
    }
  }
  // Fuzzy: startsWith (e.g. "prixd'ouverture" vs "prix").
  for (const variant of variants) {
    const target = normalizeHeader(variant);
    if (target.length <= 2) continue;
    const index = normalized.findIndex(
      (cell, i) => !used.has(i) && (cell.startsWith(target) || target.startsWith(cell))
    );
    if (index >= 0) {
      used.add(index);
      return index;
    }
  }
  return -1;
}

interface ColumnMap {
  [field: string]: number;
}

/** Tries to resolve a header row against the variant table. */
function resolveColumns(
  header: string[],
  spec: Record<string, string[]>
): ColumnMap | null {
  const used = new Set<number>();
  const map: ColumnMap = {};
  for (const [field, variants] of Object.entries(spec)) {
    const index = columnIndex(header, variants, used);
    if (index >= 0) map[field] = index;
  }
  return map;
}

/** MT4 signs costs negative → flip to app convention (positive = cost). */
function flipCost(raw: string | undefined): string {
  const parsed = parseNumber(raw);
  if (parsed === null) return "0";
  return parsed.startsWith("-") ? parsed.slice(1) : parsed;
}

const MT4_SPEC: Record<string, string[]> = {
  ticket: ["Ticket", "#"],
  openTime: ["Open Time", "Heure d'ouverture", "Ouverture", "Open"],
  type: ["Type"],
  volume: ["Size", "Volume", "Taille", "Lots"],
  symbol: ["Item", "Symbol", "Symbole", "Élément"],
  openPrice: ["Price", "Open Price", "Prix"],
  stopLoss: ["S/L", "SL", "Stop Loss"],
  takeProfit: ["T/P", "TP", "Take Profit"],
  closeTime: ["Close Time", "Heure de clôture", "Clôture", "Close"],
  closePrice: ["Price", "Close Price", "Prix"],
  commission: ["Commission"],
  taxes: ["Taxes", "Fees", "Frais"],
  swap: ["Swap"],
  profit: ["Profit"],
  comment: ["Comment", "Commentaire"],
};

const MT4_REQUIRED = ["ticket", "openTime", "type", "symbol", "volume", "profit"];

/** MT4 detailed statement: "Closed Transactions" table (EN + FR). */
export function parseMt4Html(html: string): ParseResult {
  const warnings: ImportParseWarning[] = [];
  const trades: NormalizedTradeRow[] = [];
  const cash: NormalizedCashRow[] = [];
  let skippedRows = 0;

  for (const table of extractHtmlTables(html)) {
    // Find the header row within the first rows of the table.
    let columns: ColumnMap | null = null;
    let headerIndex = -1;
    for (let i = 0; i < Math.min(4, table.length); i++) {
      const resolved = resolveColumns(table[i], MT4_SPEC);
      if (resolved && MT4_REQUIRED.every((field) => resolved[field] !== undefined)) {
        columns = resolved;
        headerIndex = i;
        break;
      }
    }
    if (!columns) {
      // Standalone Deposit/Withdrawal table: Time | Type | Amount (3 cols).
      for (const row of table) {
        if (row.length < 3) continue;
        const type = row[1]?.trim().toLowerCase() ?? "";
        const time = parseDateTime(row[0] ?? "");
        const amount = parseNumber(row[2] ?? "");
        if (
          time &&
          amount !== null &&
          ["balance", "solde", "deposit", "withdrawal", "credit", "crédit"].includes(type)
        ) {
          cash.push({
            externalId: `MT4:DW:${time}`,
            type: type === "credit" || type === "crédit" ? "BONUS" : Number(amount) >= 0 ? "DEPOSIT" : "WITHDRAWAL",
            amount,
            time,
            note: "MetaTrader 4",
          });
        }
      }
      continue; // not a closed-transactions table
    }

    for (const row of table.slice(headerIndex + 1)) {
      if (isSummaryRow(row)) {
        skippedRows++;
        continue;
      }
      const type = (row[columns.type] ?? "").trim().toLowerCase();
      const openTime = parseDateTime(row[columns.openTime] ?? "");
      const ticket = (row[columns.ticket] ?? "").trim();

      // Balance / deposit / credit rows live in the same table.
      if (["balance", "solde", "deposit", "withdrawal", "credit", "crédit"].includes(type)) {
        const amount = parseNumber(row[columns.profit] ?? "") ?? "0";
        cash.push({
          externalId: `MT4:${ticket}`,
          type: type === "credit" || type === "crédit" ? "BONUS" : Number(amount) >= 0 ? "DEPOSIT" : "WITHDRAWAL",
          amount,
          time: openTime ?? "",
          note: "MetaTrader 4",
        });
        continue;
      }

      const direction = parseDirection(row[columns.type] ?? "");
      if (!direction || !ticket) {
        skippedRows++;
        continue;
      }

      const comment = columns.comment !== undefined ? (row[columns.comment] ?? "").trim() : "";
      const chain = parseMt4ChainComment(comment);
      // Partial-close remainder ("from #N") merges into the original chain.
      const positionId = chain && chain.kind === "from" ? chain.ticket : ticket;
      const closeTime = parseDateTime(row[columns.closeTime] ?? "") ?? openTime ?? "";

      trades.push({
        externalId: `MT4:${positionId}`,
        symbol: (row[columns.symbol] ?? "").trim(),
        direction,
        volume: parseNumber(row[columns.volume] ?? "") ?? "0",
        openTime: openTime ?? "",
        openPrice: parseNumber(row[columns.openPrice] ?? "") ?? "0",
        closeTime,
        closePrice: parseNumber(row[columns.closePrice] ?? "") ?? "0",
        stopLoss: parseNumber(row[columns.stopLoss] ?? "") ?? undefined,
        takeProfit: parseNumber(row[columns.takeProfit] ?? "") ?? undefined,
        commission: flipCost(row[columns.commission]),
        swap: flipCost(row[columns.swap]),
        fees: flipCost(columns.taxes !== undefined ? row[columns.taxes] : undefined),
        profit: parseNumber(row[columns.profit] ?? "") ?? "0",
        comment: comment || undefined,
      });
    }
  }

  return {
    format: "MT4_HTML",
    formatLabel: "Relevé détaillé MT4 (HTML)",
    trades,
    cash,
    warnings,
    skippedRows,
  };
}

const MT5_SPEC: Record<string, string[]> = {
  openTime: ["Open Time", "Time", "Heure", "Ouverture"],
  position: ["Position", "Position ID", "Ticket"],
  symbol: ["Symbol", "Symbole", "Instrument"],
  type: ["Type", "Side", "Sens"],
  volume: ["Volume", "Qty", "Quantity", "Taille"],
  openPrice: ["Price", "Open Price", "Prix"],
  stopLoss: ["S/L", "SL", "Stop Loss"],
  takeProfit: ["T/P", "TP", "Take Profit"],
  closeTime: ["Close Time", "Heure de clôture", "Clôture"],
  closePrice: ["Close Price", "Prix"],
  commission: ["Commission"],
  swap: ["Swap"],
  profit: ["Profit", "P/L"],
};

const MT5_REQUIRED = ["openTime", "position", "symbol", "type", "volume"];

/** MT5 history report: rows are positions (closed trades). */
export function parseMt5Html(html: string): ParseResult {
  const warnings: ImportParseWarning[] = [];
  const trades: NormalizedTradeRow[] = [];
  const cash: NormalizedCashRow[] = [];
  let skippedRows = 0;

  for (const table of extractHtmlTables(html)) {
    let columns: ColumnMap | null = null;
    let headerIndex = -1;
    for (let i = 0; i < Math.min(4, table.length); i++) {
      const resolved = resolveColumns(table[i], MT5_SPEC);
      if (resolved && MT5_REQUIRED.every((field) => resolved[field] !== undefined)) {
        columns = resolved;
        headerIndex = i;
        break;
      }
    }
    if (!columns) continue;

    for (const row of table.slice(headerIndex + 1)) {
      if (isSummaryRow(row)) {
        skippedRows++;
        continue;
      }
      const direction = parseDirection(row[columns.type] ?? "");
      const positionId = (row[columns.position] ?? "").trim();
      const openTime = parseDateTime(row[columns.openTime] ?? "");
      if (!direction || !positionId || !openTime) {
        skippedRows++;
        continue;
      }

      trades.push({
        externalId: `MT5:${positionId}`,
        symbol: (row[columns.symbol] ?? "").trim(),
        direction,
        volume: parseNumber(row[columns.volume] ?? "") ?? "0",
        openTime,
        openPrice: parseNumber(row[columns.openPrice] ?? "") ?? "0",
        closeTime: parseDateTime(row[columns.closeTime] ?? "") ?? openTime,
        closePrice: parseNumber(row[columns.closePrice] ?? "") ?? "0",
        stopLoss: parseNumber(row[columns.stopLoss] ?? "") ?? undefined,
        takeProfit: parseNumber(row[columns.takeProfit] ?? "") ?? undefined,
        commission: flipCost(row[columns.commission]),
        swap: flipCost(row[columns.swap]),
        fees: "0",
        profit: parseNumber(row[columns.profit] ?? "") ?? "0",
      });
    }
  }

  return {
    format: "MT5_HTML",
    formatLabel: "Rapport d'historique MT5 (HTML)",
    trades,
    cash,
    warnings,
    skippedRows,
  };
}
