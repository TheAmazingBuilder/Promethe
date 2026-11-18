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

/** RFC 4180 field escaping. */
function csvField(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function yn(v: boolean | null | undefined): string {
  if (v == null) return "";
  return v ? "yes" : "no";
}

/** Full CSV document for the given rows. */
export function tradesToCsv(rows: TradeListItemDTO[]): string {
  const lines: string[] = [HEADERS.map(csvField).join(",")];
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
        .map(csvField)
        .join(",")
    );
  }
  return lines.join("\r\n");
}
