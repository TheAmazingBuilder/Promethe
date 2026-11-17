/**
 * v3 — Import dispatcher: detect → parse any supported history file.
 *
 * Runs in the browser (inside a Web Worker via import-file.worker.ts, or
 * directly in tests/Node). The server NEVER receives the raw file — only
 * normalized rows in chunks (4.5 MB serverless limit).
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ImportFileContent, ParseResult } from "./types";
import { detectFormat, refineXlsxFormat } from "./detect";
import { parseMt4Html, parseMt5Html } from "./html-parsers";
import {
  detectGenericColumns,
  makeGenericParser,
  parseCtraderRows,
  parseMt5Rows,
  parseTradingViewRows,
  type HeaderRow,
} from "./rows";
import { cleanText } from "./primitives";

export * from "./types";
export { detectFormat } from "./detect";
export { naiveToUtc } from "./primitives";
export { detectGenericColumns } from "./rows";

/** CSV → header-keyed row objects (empty header cells skipped). */
function csvToRows(text: string): HeaderRow[] {
  const result = Papa.parse<HeaderRow>(cleanText(text), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  return (result.data ?? []).filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim() !== "")
  );
}

/** XLSX → { sheetNames, rows } using the first non-empty sheet. */
function xlsxToRows(bytes: Uint8Array): { sheetNames: string[]; rows: HeaderRow[] } {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, raw: false });
  let rows: HeaderRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const candidate = XLSX.utils.sheet_to_json<HeaderRow>(sheet, {
      defval: "",
      raw: false,
    });
    if (candidate.length > rows.length) rows = candidate;
  }
  return { sheetNames: workbook.SheetNames, rows };
}

/**
 * Parses a file into normalized rows. Throws ImportParseError with a
 * machine code when nothing can be extracted (parsers fail safely with
 * actionable messages — never import garbage silently).
 */
export class ImportParseError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ImportParseError";
  }
}

export function parseImportFile(content: ImportFileContent): ParseResult {
  const detected = detectFormat(content);
  if (!detected) {
    throw new ImportParseError(
      "FORMAT_UNRECOGNIZED",
      "Format non reconnu - formats supportés : relevés MT4/MT5 (HTML), historiques MT5 (XLSX/CSV), cTrader (CSV/XLSX), TradingView (CSV), CSV générique."
    );
  }

  // ── HTML statements ──
  if (detected.format === "MT4_HTML" || detected.format === "MT5_HTML") {
    const result =
      detected.format === "MT4_HTML" ? parseMt4Html(content.text ?? "") : parseMt5Html(content.text ?? "");
    if (result.trades.length === 0 && result.cash.length === 0) {
      // MT4 detection may have been optimistic — try the MT5 shape too.
      const alternative = detected.format === "MT4_HTML" ? parseMt5Html(content.text ?? "") : parseMt4Html(content.text ?? "");
      if (alternative.trades.length > 0 || alternative.cash.length > 0) return alternative;
      throw new ImportParseError(
        "NO_TRADES_FOUND",
        "Aucun trade trouvé dans ce fichier - vérifiez qu'il s'agit bien d'un relevé d'historique (transactions clôturées)."
      );
    }
    return result;
  }

  // ── XLSX ──
  if (content.bytes && (detected.format === "MT5_XLSX" || detected.format === "CTRADER_XLSX")) {
    const { sheetNames, rows } = xlsxToRows(content.bytes);
    const format = refineXlsxFormat(detected.format, sheetNames);
    const warnings = [];
    const parsed =
      format === "CTRADER_XLSX"
        ? parseCtraderRows(rows, warnings)
        : parseMt5Rows(rows, warnings);
    if (parsed.trades.length === 0 && parsed.cash.length === 0) {
      throw new ImportParseError(
        "NO_TRADES_FOUND",
        "Aucun trade trouvé dans ce classeur - vérifiez l'onglet (Deals / Positions / Historique)."
      );
    }
    return {
      format,
      formatLabel:
        format === "CTRADER_XLSX"
          ? "cTrader (XLSX)"
          : "MetaTrader 5 Historique (XLSX)",
      ...parsed,
    };
  }

  // ── CSV families ──
  if (content.text !== undefined) {
    const rows = csvToRows(content.text);
    if (rows.length === 0) {
      throw new ImportParseError("EMPTY_FILE", "Le fichier est vide ou illisible.");
    }
    const warnings = [];

    switch (detected.format) {
      case "MT5_CSV": {
        const parsed = parseMt5Rows(rows, warnings);
        if (parsed.trades.length === 0 && parsed.cash.length === 0) {
          throw new ImportParseError("NO_TRADES_FOUND", "Colonnes MT5 détectées mais aucune ligne exploitable.");
        }
        return { format: "MT5_CSV", formatLabel: "MetaTrader 5 Historique (CSV)", ...parsed };
      }
      case "CTRADER_CSV": {
        const parsed = parseCtraderRows(rows, warnings);
        if (parsed.trades.length === 0 && parsed.cash.length === 0) {
          throw new ImportParseError("NO_TRADES_FOUND", "Colonnes cTrader détectées mais aucune ligne exploitable.");
        }
        return { format: "CTRADER_CSV", formatLabel: "cTrader (CSV)", ...parsed };
      }
      case "TRADINGVIEW_CSV": {
        const parsed = parseTradingViewRows(rows, warnings);
        if (parsed.trades.length === 0) {
          throw new ImportParseError(
            "NO_TRADES_FOUND",
            "Colonnes TradingView détectées mais aucun trade clôturé (seuls les trades remplis/clôturés sont importés)."
          );
        }
        return { format: "TRADINGVIEW_CSV", formatLabel: "TradingView Historique de compte (CSV)", ...parsed };
      }
      default: {
        // Generic CSV: auto-map columns, keep the mapping for the preview UI.
        const columns = detectGenericColumns(rows[0] ?? {});
        if (!columns.symbol || !columns.direction || !columns.openTime) {
          throw new ImportParseError(
            "GENERIC_COLUMNS_MISSING",
            "Colonnes requises non détectées (date, symbole, sens). Utilisez le mapping manuel après le dépôt du fichier."
          );
        }
        const parsed = makeGenericParser(columns)(rows, warnings);
        return {
          format: "GENERIC_CSV",
          formatLabel: "CSV générique",
          columns,
          ...parsed,
        };
      }
    }
  }

  throw new ImportParseError("FORMAT_UNRECOGNIZED", "Contenu indisponible pour l'analyse.");
}
