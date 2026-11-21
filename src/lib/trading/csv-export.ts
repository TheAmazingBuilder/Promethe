/**
 * Generic CSV export of the trade list (v1 phase 6) — pure & client-safe.
 *
 * MT4/MT5-style flat spreadsheet: one row per trade, decimals as-is (exact
 * strings from the DTO boundary), English headers. RFC 4180 quoting; \r\n
 * line endings for Excel friendliness. The API layer prepends the UTF-8 BOM.
 */
import type { TradeListItemDTO } from "@/lib/trading/dto";

const HEADERS: string[] = [
  "ID",
  "Account",
  "Strategy",
  "Symbol",
  "Direction",
  "Order type",
  "Status",
  "Timeframe",
  "Session",
  "Setup",
  "Entry date",
  "Exit date",
  "Entry price",
  "Exit price",
  "Stop loss",
  "Take profit",
  "Lots",
  "Risk %",
  "Pips",
  "Net P&L",
  "Currency",
  "R",
  "Result",
  "Exit reason",
  "Emotion before",
  "Followed plan",
  "Draft",
];

/**
 * Spreadsheet formula neutralization + RFC 4180 field escaping.
 *
 * Untrusted text beginning (possibly after whitespace/control characters)
 * with =, +, - or @ is prefixed with an apostrophe so spreadsheet software
 * treats it as text. Numeric DTO fields opt into strict decimal validation,
 * preserving legitimate negative amounts without allowing "-1+..." payloads.
 */
const NUMERIC_VALUE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORMULA_PREFIX = /^[\s\u0000-\u001F\uFEFF]*[=+\-@]/;

function csvField(
  value: string | null | undefined,
  numeric = false,
): string {
  if (value == null) return "";
  const raw = String(value);
  const isValidNumber = numeric && NUMERIC_VALUE.test(raw);
  const safe = !isValidNumber && FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  if (/[",\\r\\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function yn(v: boolean | null | undefined): string {
  if (v == null) return "";
  return v ? "yes" : "no";
}

/** Full CSV document for the given rows. */
export function tradesToCsv(rows: TradeListItemDTO[]): string {
  const lines: string[] = [HEADERS.map((header) => csvField(header)).join(",")];
  for (const t of rows) {
    lines.push(
      [
        t.id,
        t.accountName,
        t.strategyName,
        t.symbol,
        t.direction,
        t.orderType,
        t.status,
        t.timeframe,
        t.session,
        t.setupType,
        t.entryTime,
        t.exitTime,
        t.entryPrice,
        t.exitPrice,
        t.stopLoss,
        t.takeProfit,
        t.lots,
        t.riskPercent,
        t.pips,
        t.netPnl,
        t.pnlCurrency,
        t.rMultiple,
        t.resultType,
        t.exitReason,
        t.emotionBefore,
        t.followedPlan == null ? null : yn(t.followedPlan),
        yn(t.isDraft),
      ]
        .map((value, index) =>
          csvField(value, [12, 13, 14, 15, 16, 17, 18, 19, 21].includes(index))
        )
        .join(",")
    );
  }
  return lines.join("\r\n");
}
