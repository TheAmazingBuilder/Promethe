/**
 * v3 Phase 3 — Import parser tests against fixtures (tests/fixtures/imports/).
 *
 * Fixtures are SYNTHETIC (generated from the documented formats) — the README
 * marks which parsers are unverified against real exports.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "@/lib/import";
import { detectFormat } from "@/lib/import/detect";
import {
  MAX_IMPORT_FILE_BYTES,
  assertImportFileSize,
  cleanText,
  decodeImportText,
  naiveToUtc,
  parseDateTime,
  parseNumber,
} from "@/lib/import/primitives";
import { buildErrorReportCsv } from "@/hooks/use-import";

const fixtures = path.resolve(__dirname, "../fixtures/imports");
const read = (name: string) => readFileSync(path.join(fixtures, name), "utf8");

describe("primitives — tolerant numbers", () => {
  it("parses dot decimals", () => {
    expect(parseNumber("2650.50")).toBe("2650.50");
    expect(parseNumber("-0.70")).toBe("-0.70");
  });

  it("parses comma decimals and NBSP thousands (FR)", () => {
    expect(parseNumber("2\u00a0800,50")).toBe("2800.50");
    expect(parseNumber("0,25")).toBe("0.25");
    expect(parseNumber("-1,25")).toBe("-1.25");
    expect(parseNumber("1 234,56")).toBe("1234.56");
  });

  it("parses US thousands", () => {
    expect(parseNumber("1,234.56")).toBe("1234.56");
    expect(parseNumber("10 300.70")).toBe("10300.70");
  });

  it("handles empties and accounting negatives", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("—")).toBeNull();
    expect(parseNumber("(123.45)")).toBe("-123.45");
    expect(parseNumber("123.45-")).toBe("-123.45");
    expect(parseNumber("$1 500")).toBe("1500");
  });
});

describe("primitives — dates", () => {
  it("normalizes MT formats to naive YYYY-MM-DD HH:mm:ss", () => {
    expect(parseDateTime("2025.01.15 08:32")).toBe("2025-01-15 08:32:00");
    expect(parseDateTime("2025.01.15 08:32:00")).toBe("2025-01-15 08:32:00");
    expect(parseDateTime("2025-01-15T14:30:05Z")).toBe("2025-01-15 14:30:05");
    expect(parseDateTime("2025/01/15 14:30")).toBe("2025-01-15 14:30:00");
    expect(parseDateTime("15.01.2025 14:30")).toBe("2025-01-15 14:30:00");
    expect(parseDateTime("2025.01.15")).toBe("2025-01-15 00:00:00");
  });

  it("converts naive times to UTC with the declared timezone (DST-aware)", () => {
    // Paris GMT+1 in January, GMT+2 in July (DST).
    const january = naiveToUtc("2025-01-15 14:30:00", "Europe/Paris");
    expect(january.toISOString()).toBe("2025-01-15T13:30:00.000Z");
    const july = naiveToUtc("2025-07-15 14:30:00", "Europe/Paris");
    expect(july.toISOString()).toBe("2025-07-15T12:30:00.000Z");
    // Toronto GMT-5 in January.
    const toronto = naiveToUtc("2025-01-15 09:30:00", "America/Toronto");
    expect(toronto.toISOString()).toBe("2025-01-15T14:30:00.000Z");
  });
});

describe("detection", () => {
  it("recognizes each fixture by content", () => {
    expect(detectFormat({ fileName: "s.html", extension: "html", text: read("mt4-statement-en.html") })?.format)
      .toBe("MT4_HTML");
    expect(detectFormat({ fileName: "s.html", extension: "html", text: read("mt5-report.html") })?.format)
      .toBe("MT5_HTML");
    expect(detectFormat({ fileName: "h.csv", extension: "csv", text: read("mt5-history.csv") })?.format)
      .toBe("MT5_CSV");
    expect(detectFormat({ fileName: "c.csv", extension: "csv", text: read("ctrader.csv") })?.format)
      .toBe("CTRADER_CSV");
    expect(detectFormat({ fileName: "tv.csv", extension: "csv", text: read("tradingview.csv") })?.format)
      .toBe("TRADINGVIEW_CSV");
    expect(detectFormat({ fileName: "g.csv", extension: "csv", text: read("generic-fr.csv") })?.format)
      .toBe("GENERIC_CSV");
  });
});

describe("MT4 HTML statement (EN)", () => {
  const result = parseImportFile({ fileName: "s.html", extension: "html", text: read("mt4-statement-en.html") });

  it("parses the closed trades with correct column mapping (two Price columns)", () => {
    expect(result.format).toBe("MT4_HTML");
    expect(result.trades).toHaveLength(3);

    const first = result.trades[0]!;
    expect(first.externalId).toBe("MT4:100000001");
    expect(first.symbol).toBe("XAUUSD");
    expect(first.direction).toBe("LONG");
    expect(first.volume).toBe("0.50");
    expect(first.openTime).toBe("2025-01-15 08:32:00");
    expect(first.openPrice).toBe("2650.50");
    expect(first.closeTime).toBe("2025-01-15 11:05:00");
    expect(first.closePrice).toBe("2655.80"); // NOT the open price
    expect(first.stopLoss).toBe("2645.00");
    expect(first.takeProfit).toBe("2662.00");
    expect(first.commission).toBe("2.50"); // flipped from -2.50
    expect(first.swap).toBe("0.30");
    expect(first.profit).toBe("265.00");
  });

  it("parses the SHORT EURUSD row", () => {
    const second = result.trades[1]!;
    expect(second.direction).toBe("SHORT");
    expect(second.closePrice).toBe("1.08320");
    expect(second.profit).toBe("18.00");
  });

  it("collects deposits/withdrawals as cash rows", () => {
    expect(result.cash).toHaveLength(2);
    expect(result.cash[0]!.type).toBe("DEPOSIT");
    expect(result.cash[0]!.amount).toBe("10000.00");
    expect(result.cash[1]!.type).toBe("WITHDRAWAL");
    expect(result.cash[1]!.amount).toBe("-500.00");
  });

  it("skips the balance summary row", () => {
    expect(result.skippedRows).toBeGreaterThanOrEqual(1);
    expect(result.trades.every((t) => t.symbol !== "")).toBe(true);
  });
});

describe("MT4 HTML statement (FR, decimal commas, NBSP)", () => {
  const result = parseImportFile({ fileName: "r.html", extension: "html", text: read("mt4-statement-fr.html") });

  it("parses French headers and numbers", () => {
    expect(result.trades).toHaveLength(2);
    const first = result.trades[0]!;
    expect(first.openPrice).toBe("2800.50");
    expect(first.closePrice).toBe("2806.30");
    expect(first.volume).toBe("0.25");
    expect(first.commission).toBe("1.25");
    expect(first.direction).toBe("LONG");
    // Broker symbols pass through for SymbolMapping.
    expect(first.symbol).toBe("XAUUSDm");
    expect(result.trades[1]!.symbol).toBe("EURUSD.pro");
  });
});

describe("MT5 HTML report", () => {
  const result = parseImportFile({ fileName: "r.html", extension: "html", text: read("mt5-report.html") });

  it("parses positions with their ids", () => {
    expect(result.format).toBe("MT5_HTML");
    expect(result.trades).toHaveLength(3);
    const first = result.trades[0]!;
    expect(first.externalId).toBe("MT5:5001");
    expect(first.symbol).toBe("XAUUSDm");
    expect(first.openPrice).toBe("2915.20");
    expect(first.closePrice).toBe("2922.80");
    expect(first.commission).toBe("3.20");
    expect(first.swap).toBe("0.40");
    expect(first.profit).toBe("304.00");
    expect(result.trades[2]!.profit).toBe("-60.00");
  });
});

describe("MT5 history CSV (deal rows grouped by position)", () => {
  const result = parseImportFile({ fileName: "h.csv", extension: "csv", text: read("mt5-history.csv") });

  it("groups in/out deals into positions", () => {
    expect(result.format).toBe("MT5_CSV");
    expect(result.trades).toHaveLength(2);
    const gold = result.trades[0]!;
    expect(gold.externalId).toBe("MT5:6001");
    expect(gold.direction).toBe("LONG");
    expect(gold.openTime).toBe("2025-04-01 09:30:00");
    expect(gold.closeTime).toBe("2025-04-01 14:20:00");
    expect(gold.closePrice).toBe("3208.50");
    expect(Number(gold.commission)).toBe(3); // two deals × 1.50
    expect(Number(gold.swap)).toBe(0.2);
    expect(Number(gold.profit)).toBe(255);
    const euro = result.trades[1]!;
    expect(euro.direction).toBe("SHORT");
    expect(euro.closePrice).toBe("1.08850");
  });

  it("maps balance deals to cash rows", () => {
    expect(result.cash).toHaveLength(1);
    expect(result.cash[0]!.type).toBe("DEPOSIT");
    expect(result.cash[0]!.amount).toBe("1000.00");
  });
});

describe("cTrader CSV", () => {
  const result = parseImportFile({ fileName: "c.csv", extension: "csv", text: read("ctrader.csv") });

  it("groups deals by Position ID and converts units", () => {
    expect(result.format).toBe("CTRADER_CSV");
    expect(result.trades).toHaveLength(2);
    const gold = result.trades[0]!;
    expect(gold.externalId).toBe("CT:7001");
    expect(gold.symbol).toBe("XAUUSD");
    expect(gold.volume).toBe("250"); // cTrader units (not lots) — passed through
    expect(gold.openPrice).toBe("3250.60");
    expect(gold.closePrice).toBe("3257.40");
    expect(gold.commission).toBe("2.35");
    expect(Number(gold.profit)).toBe(168.5);
  });

  it("captures deposits", () => {
    expect(result.cash).toHaveLength(1);
    expect(result.cash[0]!.type).toBe("DEPOSIT");
    expect(result.cash[0]!.amount).toBe("500.00");
  });
});

describe("TradingView CSV", () => {
  const result = parseImportFile({ fileName: "tv.csv", extension: "csv", text: read("tradingview.csv") });

  it("parses round-trips with deterministic ids", () => {
    expect(result.format).toBe("TRADINGVIEW_CSV");
    expect(result.trades).toHaveLength(3);
    const first = result.trades[0]!;
    expect(first.symbol).toBe("XAUUSD");
    expect(first.direction).toBe("LONG");
    expect(first.volume).toBe("0.5");
    expect(first.openTime).toBe("2025-06-01 09:45:30");
    expect(first.closePrice).toBe("3257.40");
    expect(first.profit).toBe("335.00");
    expect(first.externalId).toContain("TV:XAUUSD:LONG");
    expect(result.trades[2]!.profit).toBe("-145.40");
  });
});

describe("Generic CSV (FR, semicolons, BOM, separate date/time columns)", () => {
  const result = parseImportFile({ fileName: "g.csv", extension: "csv", text: read("generic-fr.csv") });

  it("auto-maps columns and parses comma decimals", () => {
    expect(result.format).toBe("GENERIC_CSV");
    expect(result.columns).toMatchObject({ symbol: "Symbole", direction: "Sens", volume: "Volume" });
    expect(result.trades).toHaveLength(2);
    const first = result.trades[0]!;
    expect(first.symbol).toBe("XAUUSD");
    expect(first.direction).toBe("LONG");
    expect(first.openTime).toBe("2025-07-01 09:30:00");
    expect(first.closeTime).toBe("2025-07-01 14:20:00");
    expect(first.openPrice).toBe("3310.50");
    expect(first.commission).toBe("1.00");
  });
});

describe("failure modes", () => {
  it("throws a coded error for unrecognized content", () => {
    expect(() =>
      parseImportFile({ fileName: "x.txt", extension: "txt", text: "hello world\nnothing here" })
    ).toThrow(/required columns|not recognized/i);
  });

  it("throws NO_TRADES_FOUND for an HTML file without trade tables", () => {
    expect(() =>
      parseImportFile({
        fileName: "x.html",
        extension: "html",
        text: "<html><body><table><tr><td>nothing</td></tr></table></body></html>",
      })
    ).toThrow(/No trades found/);
  });

  it("never imports garbage silently (empty CSV)", () => {
    expect(() =>
      parseImportFile({ fileName: "e.csv", extension: "csv", text: "a,b,c\n1,2,3\n" })
    ).toThrow();
  });
});

// ── §20 - file size cap, encoding fallback, BOM'd error report ─────────────

describe("decodeImportText - strict UTF-8 with Windows-1252 fallback", () => {
  it("decodes valid UTF-8 unchanged", () => {
    const bytes = new TextEncoder().encode("Trade clôturée, café €");
    expect(decodeImportText(bytes)).toBe("Trade clôturée, café €");
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    // cp1252 bytes for "Trade clôturée" - 0xF4/0xE9 are lone continuation
    // bytes in UTF-8, so the strict decoder rejects them.
    const bytes = new Uint8Array([
      0x54, 0x72, 0x61, 0x64, 0x65, 0x20, 0x63, 0x6c, 0xf4, 0x74, 0x75,
      0x72, 0xe9, 0x65,
    ]);
    expect(decodeImportText(bytes)).toBe("Trade clôturée");
  });

  it("strips a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]);
    expect(decodeImportText(bytes)).toBe("a,b");
  });
});

describe("assertImportFileSize - 25 MB cap", () => {
  it("accepts a file at the cap", () => {
    expect(() =>
      assertImportFileSize({ size: MAX_IMPORT_FILE_BYTES, name: "ok.csv" })
    ).not.toThrow();
  });

  it("rejects a file over the cap with a coded error", () => {
    expect(() =>
      assertImportFileSize({
        size: MAX_IMPORT_FILE_BYTES + 1,
        name: "big.csv",
      })
    ).toThrow(/File too large/);
    try {
      assertImportFileSize({ size: MAX_IMPORT_FILE_BYTES + 1, name: "big.csv" });
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("FILE_TOO_LARGE");
    }
  });
});

describe("buildErrorReportCsv - UTF-8 BOM for Excel on Windows", () => {
  it("starts with a BOM and lists the failed rows", () => {
    const csv = buildErrorReportCsv([
      { row: 3, code: "MISSING_ENTRY_PRICE", detail: "Missing entry price" },
      { row: 7, code: "BAD_DATE", detail: "Bad date" },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"row","externalId","code","detail"');
    expect(csv).toContain('"3","","MISSING_ENTRY_PRICE","Missing entry price"');
    expect(csv).toContain('"7","","BAD_DATE","Bad date"');
  });
});
