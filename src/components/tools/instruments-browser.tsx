"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Info, RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ASSET_CLASSES, type AssetClass } from "@/lib/trading/types";
import { getFormatLocale } from "@/lib/format";

interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  baseCurrency: string | null;
  quoteCurrency: string;
  digits: number;
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize: string | null;
}

const CLASS_BADGE: Record<string, string> = {
  METAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  FOREX: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  INDEX: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  CRYPTO: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  COMMODITY: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  STOCK: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  FUTURES: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
};

export function InstrumentsBrowser() {
  const t = useTranslations("tools");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");

  const [instruments, setInstruments] = React.useState<InstrumentRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [assetClass, setAssetClass] = React.useState<string>("ALL");

  const load = React.useCallback(async () => {
    setError(null);
    setInstruments(null);
    try {
      const res = await fetch("/api/instruments");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { instruments: InstrumentRow[] };
      setInstruments(data.instruments);
    } catch (e) {
      setError(
        e instanceof Error
          ? t("loadError", { message: e.message })
          : t("unknownError")
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    if (!instruments) return null;
    const q = search.trim().toLowerCase();
    return instruments.filter((i) => {
      if (assetClass !== "ALL" && i.assetClass !== assetClass) return false;
      if (!q) return true;
      return (
        i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
      );
    });
  }, [instruments, search, assetClass]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="inst-search">{t("search")}</Label>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="inst-search"
              placeholder={t("searchPlaceholder")}
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="w-full space-y-2 sm:w-48">
          <Label htmlFor="inst-class">{t("assetClass")}</Label>
          <Select value={assetClass} onValueChange={setAssetClass}>
            <SelectTrigger id="inst-class" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{tCommon("all")}</SelectItem>
              {ASSET_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {tRoot(`trading.assetClass.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {tCommon("retry")}
          </Button>
        </div>
      )}

      {!error && filtered === null && (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {filtered && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("instrumentCount", { count: filtered.length })}
          </p>
          <div className="max-h-[28rem] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t("colSymbol")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("colName")}</TableHead>
                  <TableHead>{t("colClass")}</TableHead>
                  <TableHead className="text-right">{t("colDigits")}</TableHead>
                  <TableHead className="text-right">{t("colPip")}</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">{t("colPoint")}</TableHead>
                  <TableHead className="text-right">{t("colContract")}</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">{t("colQuote")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium tabular-nums">{i.symbol}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {i.name}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={CLASS_BADGE[i.assetClass] ?? undefined}
                      >
                        {ASSET_CLASSES.includes(i.assetClass as AssetClass)
                          ? tRoot(`trading.assetClass.${i.assetClass}`)
                          : i.assetClass}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.digits}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.pipSize}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {i.pointSize}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(i.contractSize).toLocaleString(getFormatLocale())}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {i.quoteCurrency}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {t("noResults")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            {t("xauPipNote")}{" "}{t("xauPipSuffix")}
          </p>
        </>
      )}
    </div>
  );
}
