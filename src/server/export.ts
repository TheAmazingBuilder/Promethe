/**
 * CSV export of the filtered trade list (v1 phase 6).
 *
 * Reuses the exact same filter → where translation as the list endpoint
 * (tradeListWhere) so an export always matches what the user sees. Rows
 * are capped (10k) to keep the response bounded; the CSV document itself
 * is built by the pure generator in /src/lib/trading/csv-export.ts.
 */
import { db } from "@/lib/db";
import { tradeListWhere } from "@/server/trades";
import { toTradeListItem } from "@/server/trades";
import { tradesToCsv, type CsvLocale } from "@/lib/trading/csv-export";
import type { TradeListItemDTO } from "@/lib/trading/dto";
import type { TradeListQuery } from "@/lib/validations/trade";

const MAX_EXPORT_ROWS = 10_000;

export async function exportTradesCsv(
  userId: string,
  query: TradeListQuery,
  locale: CsvLocale
): Promise<{ csv: string; count: number; truncated: boolean }> {
  const rows = await db.trade.findMany({
    where: tradeListWhere(userId, query),
    include: {
      instrument: true,
      account: true,
      strategy: true,
      tags: { include: { tag: true } },
    },
    orderBy: { [query.sort]: query.order },
    take: MAX_EXPORT_ROWS + 1,
  });
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const items: TradeListItemDTO[] = rows
    .slice(0, MAX_EXPORT_ROWS)
    .map(toTradeListItem);
  return {
    csv: tradesToCsv(items, locale),
    count: items.length,
    truncated,
  };
}
