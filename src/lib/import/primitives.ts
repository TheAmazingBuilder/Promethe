/**
 * v3 — Tolerant parsing primitives for localized broker exports (v3 §4.2):
 * French/English headers, decimal commas, space & non-breaking-space
 * thousand separators, BOM, odd encodings, summary rows.
 *
 * Pure, Node + browser safe (no DOM).
 */

const NBSP = /\u00a0|\u202f/g;

/** Strips a BOM and normalizes invisible separators. */
export function cleanText(input: string): string {
  return input.replace(/^\uFEFF/, "").replace(NBSP, " ");
}

/**
 * Parses a number as printed in a statement: handles "1 234,56",
 * "1,234.56", "1 234.56", "-0,70", "(123.45)" (accounting negatives),
 * "" (empty → null), "—" (null). Returns a plain string in canonical
 * dot-decimal form, or null when unparseable.
 */
export function parseNumber(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = cleanText(String(raw)).trim();
  if (!s || s === "-" || s === "-" || s === "-") return null;

  // Accounting negative: (123.45)
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }

  s = s.replace(/[^\d.,\-+]/g, ""); // strip currency symbols etc.
  if (!s || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the LAST separator is the decimal one.
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Comma only: decimal if followed by 1-2 digits at the end, else thousands.
    const tail = s.length - lastComma - 1;
    normalized = tail >= 1 && tail <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else {
    normalized = s;
  }

  normalized = normalized.replace(/(?!^)-/g, ""); // inner minus garbage
  if (!/^-?\d*\.?\d+$/.test(normalized)) return null;
  if (negative && !normalized.startsWith("-")) normalized = "-" + normalized;
  // Canonical form: drop useless trailing ".0"? NO — keep exact (decimals).
  return normalized;
}

/**
 * Parses a price: like parseNumber but rejects absurd results (NaN).
 * Kept separate for future instrument-digit rounding.
 */
export function parsePrice(raw: string | null | undefined): string | null {
  return parseNumber(raw);
}

/** Naive date-time formats seen in MT4/MT5/cTrader/TV exports. */
const DATE_TIME_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  // 2025.01.15 14:30 / 2025.01.15 14:30:05
  {
    re: /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    build: (m) => pad(m[1], 4) + "-" + pad(m[2], 2) + "-" + pad(m[3], 2) + " " + pad(m[4], 2) + ":" + m[5] + ":" + (m[6] ?? "00"),
  },
  // 15.01.2025 14:30 (European day-first) — MT4 EN statements
  {
    re: /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    build: (m) => {
      // Day-first vs month-first: both exist. Day-first when first > 12 or
      // (european heuristic) second <= 12 — ambiguous dates resolve as
      // day-first because MT statements are day-first.
      const a = Number(m[1]);
      const b = Number(m[2]);
      const day = a > 12 ? a : a; // day-first default
      const month = a > 12 ? b : b <= 12 ? b : b;
      void day; void month;
      return pad(m[3], 4) + "-" + pad(m[2], 2) + "-" + pad(m[1], 2) + " " + pad(m[4], 2) + ":" + m[5] + ":" + (m[6] ?? "00");
    },
  },
  // 2025-01-15T14:30:05 (already ISO-ish)
  {
    re: /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
    build: (m) => `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`,
  },
  // 2025-01-15 14:30:05
  {
    re: /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    build: (m) => pad(m[1], 4) + "-" + pad(m[2], 2) + "-" + pad(m[3], 2) + " " + pad(m[4], 2) + ":" + m[5] + ":" + (m[6] ?? "00"),
  },
  // 2025/01/15 14:30
  {
    re: /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    build: (m) => pad(m[1], 4) + "-" + pad(m[2], 2) + "-" + pad(m[3], 2) + " " + pad(m[4], 2) + ":" + m[5] + ":" + (m[6] ?? "00"),
  },
  // Date only: 2025.01.15 / 15.01.2025 → midnight
  {
    re: /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/,
    build: (m) => pad(m[1], 4) + "-" + pad(m[2], 2) + "-" + pad(m[3], 2) + " 00:00:00",
  },
  {
    re: /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/,
    build: (m) => pad(m[3], 4) + "-" + pad(m[2], 2) + "-" + pad(m[1], 2) + " 00:00:00",
  },
  // TradingView epoch seconds
  {
    re: /^(\d{10})$/,
    build: (m) => epochToNaive(Number(m[1])),
  },
];

function pad(value: string | number, length: number): string {
  return String(value).padStart(length, "0");
}

function epochToNaive(seconds: number): string {
  const date = new Date(seconds * 1000);
  return (
    date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1, 2) + "-" + pad(date.getUTCDate(), 2) +
    " " + pad(date.getUTCHours(), 2) + ":" + pad(date.getUTCMinutes(), 2) + ":" + pad(date.getUTCSeconds(), 2)
  );
}

/**
 * Normalizes any statement date-time to a NAIVE "YYYY-MM-DD HH:mm:ss"
 * string (no timezone conversion — the batch timezone is applied
 * server-side). Returns null when unparseable.
 */
export function parseDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = cleanText(String(raw)).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  for (const pattern of DATE_TIME_PATTERNS) {
    const match = cleaned.match(pattern.re);
    if (match) return pattern.build(match);
  }
  // Fallback: Date.parse (browser-dependent but best effort).
  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return epochToNaive(Math.floor(parsed / 1000));
  return null;
}

/**
 * Converts a NAIVE local date-time from a declared IANA timezone to a UTC
 * Date. Uses the standard Intl trick (no extra dependency).
 */
export function naiveToUtc(naive: string, timeZone: string): Date {
  const asUtc = Date.parse(naive.replace(" ", "T") + "Z");
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asInterpreted = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second")
  );
  const offsetMinutes = Math.round((asInterpreted - asUtc) / 60000);
  return new Date(asUtc - offsetMinutes * 60000);
}

/** Direction from any broker wording. */
export function parseDirection(raw: string | null | undefined): "LONG" | "SHORT" | null {
  if (!raw) return null;
  const value = cleanText(String(raw)).trim().toLowerCase();
  if (["buy", "b", "long", "achat", "acheter", "ach", "a", "buy limit", "buy stop", "buy/livre", "acheté"].some((word) => value.startsWith(word))) return "LONG";
  if (["sell", "s", "short", "vente", "vendre", "ven", "v", "sell limit", "sell stop", "vendu"].some((word) => value.startsWith(word))) return "SHORT";
  return null;
}

/** True for summary/garbage rows that must be skipped. */
export function isSummaryRow(cells: (string | null | undefined)[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return (
    joined.includes("balance:") ||
    joined.includes("solde :") ||
    joined.includes("total ") ||
    joined.includes("total :") ||
    joined.includes("grand total") ||
    joined.includes("sous-total") ||
    joined.includes("subtotal") ||
    /^statements?/.test(joined) ||
    joined.includes("closed transactions") ||
    joined.includes("transactions clôturées") ||
    /^$/.test(joined.replace(/[^a-z]/g, ""))
  );
}

/** Minimal HTML entity decoding for cell text. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Extracts tables from statement HTML without a DOM: returns
 * tables → rows → cells (text). Handles the regular, well-formed markup
 * MetaTrader emits. Nested tables flatten into the outer table.
 */
export function extractHtmlTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const rows: string[][] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
      const cells: string[] = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(decodeEntities(cellMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}
