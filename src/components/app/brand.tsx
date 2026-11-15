import { CandlestickChart } from "lucide-react";

/** Logo + wordmark, shared by the auth screen, sidebar and mobile sheet. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white"
        aria-hidden="true"
      >
        <CandlestickChart className="h-4.5 w-4.5" />
      </div>
      <span className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
        <span className="text-sm font-semibold tracking-tight">TradeJournal</span>
        {!compact && (
          <span className="mt-0.5 text-[10px] text-muted-foreground">
            XAUUSD · Forex
          </span>
        )}
      </span>
    </div>
  );
}
