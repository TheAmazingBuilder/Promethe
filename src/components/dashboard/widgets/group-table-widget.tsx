"use client";

/**
 * strategy-table / instrument-table widgets — grouped stats table ported
 * from the old strategy stats table, sorted by net P&L desc, limit sliced.
 */
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Money } from "@/components/privacy/money";
import { tableLimitConfigSchema } from "@/lib/dashboard/registry";
import { fmtNum, fmtSigned, pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { toD } from "@/lib/trading/dec";
import { asGroupsData } from "./types";

function parseLimit(config: unknown): number {
  const parsed = tableLimitConfigSchema.safeParse(config ?? {});
  return parsed.success ? (parsed.data.limit as number) : 6;
}

export function GroupTableWidget({
  data,
  config,
  currency,
  kind,
}: {
  data: unknown;
  config: unknown;
  currency: string;
  kind: "strategy" | "instrument";
}) {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const limit = parseLimit(config);
  const groups = asGroupsData(data)?.groups ?? [];

  const rows = [...groups]
    .sort((a, b) => toD(b.stats.netPnl).cmp(toD(a.stats.netPnl)))
    .slice(0, limit);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {kind === "strategy" ? t("strategiesEmpty") : t("kpiNoData")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("stratColStrategy")}</TableHead>
            <TableHead scope="col" className="text-right">
              {t("stratColTrades")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("stratColWinRate")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("stratColNet")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("stratColAvgR")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((g) => (
            <TableRow key={g.key}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {kind === "strategy" ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: g.color ?? "#64748b" }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="font-medium">{g.key}</span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtNum(g.stats.tradeCount, 0)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {g.stats.winRate != null ? fmt.pct(g.stats.winRate) : "—"}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${pnlClass(g.stats.netPnl)}`}
              >
                <Money signed value={g.stats.netPnl} currency={currency} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtSigned(g.stats.avgR)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
