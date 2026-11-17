"use client";

/** recent-trades widget - the recent trades table ported from the old view. */
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DirectionBadge,
  DraftBadge,
  ResultBadge,
} from "@/components/trades/trade-bits";
import { recentTradesConfigSchema } from "@/lib/dashboard/registry";
import { fmtDateTimeInTz, fmtSigned, pnlClass } from "@/lib/format";
import { Money } from "@/components/privacy/money";
import { navigate } from "@/lib/router";
import { asTradesData } from "./types";

function parseLimit(config: unknown): number {
  const parsed = recentTradesConfigSchema.safeParse(config ?? {});
  return parsed.success ? (parsed.data.limit as number) : 6;
}

export function RecentTradesWidget({
  data,
  config,
  timezone,
}: {
  data: unknown;
  config: unknown;
  timezone: string;
}) {
  const t = useTranslations("dashboard");
  const tTradeCols = useTranslations("trades.list");
  const limit = parseLimit(config);
  const trades = (asTradesData(data)?.trades ?? []).slice(0, limit);

  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("kpiNoData")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("colSymbol")}</TableHead>
            <TableHead scope="col">{tTradeCols("colDate")}</TableHead>
            <TableHead scope="col" className="text-right">
              {tTradeCols("colPips")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {tTradeCols("colR")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {tTradeCols("colPnl")}
            </TableHead>
            <TableHead scope="col">{tTradeCols("colResult")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow
              key={trade.id}
              className="cursor-pointer"
              onClick={() => navigate(`#/trades/${trade.id}`)}
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{trade.symbol}</span>
                  <DirectionBadge direction={trade.direction} />
                  {trade.isDraft ? <DraftBadge /> : null}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {fmtDateTimeInTz(trade.entryTime, timezone)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtSigned(trade.pips)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtSigned(trade.rMultiple)}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${pnlClass(trade.netPnl)}`}
              >
                <Money signed value={trade.netPnl} currency={trade.pnlCurrency} />
              </TableCell>
              <TableCell>
                {trade.resultType ? (
                  <ResultBadge result={trade.resultType} />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
