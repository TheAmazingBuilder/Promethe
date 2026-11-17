/**
 * v3 — Format auto-detection from CONTENT signatures (not just the
 * extension), per v3 §4.2.
 */
import type { DetectedFormat, ImportFileContent, ImportFormat } from "./types";
import { cleanText } from "./primitives";

/** Lowercases + strips separators/accents for header matching. */
export function normalizeHeader(header: string): string {
  return cleanText(header)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const HTML_TABLES = /<table/i;
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function isXlsx(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === XLSX_MAGIC[0] &&
    bytes[1] === XLSX_MAGIC[1] &&
    bytes[2] === XLSX_MAGIC[2] &&
    bytes[3] === XLSX_MAGIC[3]
  );
}

function csvHeaderLine(text: string): string {
  return cleanText(text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "");
}

export function detectFormat(content: ImportFileContent): DetectedFormat | null {
  const extension = content.extension.toLowerCase();

  // ── XLSX (magic bytes) ──
  if (content.bytes && isXlsx(content.bytes)) {
    return {
      format: "MT5_XLSX",
      label: "Excel (.xlsx)",
      confidence: "likely",
      reason: "xlsx-signature",
    };
  }

  if (content.text !== undefined) {
    const text = cleanText(content.text);
    const lower = text.toLowerCase();

    // ── HTML statements ──
    if (HTML_TABLES.test(text)) {
      if (
        lower.includes("closed transactions") ||
        lower.includes("transactions cl") ||
        (lower.includes("plateform") && lower.includes("metaquotes"))
      ) {
        return {
          format: "MT4_HTML",
          label: "Detailed MT4 statement (HTML)",
          confidence: "certain",
          reason: "html-closed-transactions",
        };
      }
      if (
        lower.includes("trade history report") ||
        lower.includes("rapport historique") ||
        (lower.includes("deals") && lower.includes("metaquotes"))
      ) {
        return {
          format: "MT5_HTML",
          label: "MT5 history report (HTML)",
          confidence: "certain",
          reason: "html-trade-history",
        };
      }
      return {
        format: "MT4_HTML",
        label: "HTML statement",
        confidence: "likely",
        reason: "html-tables",
      };
    }

    // ── CSV families (header signatures) ──
    const header = normalizeHeader(csvHeaderLine(text));
    const has = (...needles: string[]) => needles.every((n) => header.includes(normalizeHeader(n)));

    if (has("dealid") || (has("positionid") && has("dealid"))) {
      return {
        format: "CTRADER_CSV",
        label: "cTrader (CSV)",
        confidence: "certain",
        reason: "dealid-column",
      };
    }
    if (has("positionid") || (has("ticket") && has("opentime") && has("sl"))) {
      return {
        format: "MT5_CSV",
        label: "MetaTrader 5 History (CSV)",
        confidence: "certain",
        reason: "positionid-column",
      };
    }
    if (has("avgfilledprice") || has("avgfilled") || (has("symbol") && has("side") && has("status"))) {
      return {
        format: "TRADINGVIEW_CSV",
        label: "TradingView account history (CSV)",
        confidence: "certain",
        reason: "tv-columns",
      };
    }
    if (extension === "csv" || extension === "txt" || extension === "tsv") {
      return {
        format: "GENERIC_CSV",
        label: "Generic CSV",
        confidence: "likely",
        reason: "fallback",
      };
    }
  }

  return null;
}

/** Sheet-name refinement for XLSX (cTrader exports name theirs). */
export function refineXlsxFormat(format: ImportFormat, sheetNames: string[]): ImportFormat {
  if (format !== "MT5_XLSX") return format;
  const names = sheetNames.map((name) => name.toLowerCase());
  if (names.some((name) => name.includes("ctrader")) || names.includes("deals")) {
    // "Deals" is ambiguous (MT5 too) — keep MT5 unless explicit cTrader marker.
    if (names.some((name) => name.includes("ctrader"))) return "CTRADER_XLSX";
  }
  return "MT5_XLSX";
}
