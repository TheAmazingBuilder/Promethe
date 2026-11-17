/** Logo + wordmark, shared by the auth screen, sidebar and mobile sheet. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Promethe — Phoenix 1, primary logo (emerald/teal, transparent). */}
      <img
        src="/brand/phoenix-1.png"
        alt="Promethe"
        className="h-8 w-8 shrink-0 rounded-lg object-contain transition-all duration-300 hover:scale-105 hover:drop-shadow-[0_0_14px_rgba(16,185,129,0.55)]"
      />
      <span className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
        <span className="text-sm font-semibold tracking-tight">Promethe</span>
        {!compact && (
          <span className="mt-0.5 text-[10px] text-muted-foreground">
            Rise from every trade.
          </span>
        )}
      </span>
    </div>
  );
}
