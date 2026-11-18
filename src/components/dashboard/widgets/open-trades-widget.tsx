"use client";

/** open-trades widget - the open positions table ported from the old view. */
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DirectionBadge } from "@/components/trades/trade-bits";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  fmtDateTimeInTz,
  fmtNum,
  fmtPrice,
} from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { asOpenTradesData } from "./types";

export function OpenTradesWidget({
  data,
  timezone,
}: {
  data: unknown;
  timezone: string;
}) {
  const t = useTranslations("dashboard");
  const fmt = useFormat();
  const positions = asOpenTradesData(data)?.openPositions ?? [];

  if (positions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("openPositionsEmpty")}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("openPositionsCount", { count: positions.length })}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("colSymbol")}</TableHead>
              <TableHead scope="col">{t("colEntry")}</TableHead>
              <TableHead scope="col">{t("colLots")}</TableHead>
              <TableHead scope="col">{t("colSl")}</TableHead>
              <TableHead scope="col">{t("colRisk")}</TableHead>
              <TableHead scope="col">{t("colSince")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate(`/trades/${p.id}`)}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{p.symbol}</span>
                    <DirectionBadge direction={p.direction} />
                  </span>
                  {p.strategyName ? (
                    <span className="block text-xs text-muted-foreground">
                      {p.strategyName}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="block font-medium tabular-nums">
                    {fmtPrice(p.entryPrice, p.digits)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <Sensitive kind="account">{p.accountName}</Sensitive>
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  <Sensitive kind="lots">{fmtNum(p.lots, 2)}</Sensitive>
                </TableCell>
                <TableCell className="tabular-nums">
                  <span className="block">{fmtPrice(p.stopLoss, p.digits)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtPrice(p.takeProfit, p.digits)}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {p.riskAmount ? (
                    <Money value={p.riskAmount} currency={p.pnlCurrency} />
                  ) : p.riskPercent ? (
                    fmt.pct(p.riskPercent)
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fmtDateTimeInTz(p.entryTime, timezone)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
