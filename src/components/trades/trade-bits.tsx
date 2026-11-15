"use client";

/**
 * Shared building blocks for the trade views (list, form, quick, detail,
 * templates): localized enum labels, badges, instrument helpers and the
 * reference selectors (account / instrument / strategy / timeframe).
 *
 * Everything here is client-safe and presentation-only — no Prisma, no
 * business logic. Money/price math stays in /src/lib/trading.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAccounts,
  useInstruments,
  useStrategies,
  type InstrumentApiDTO,
} from "@/hooks/use-trading";
import type { AccountDTO, StrategyDTO, TagDTO } from "@/lib/trading/dto";
import { TIMEFRAMES, type InstrumentSpec } from "@/lib/trading/types";

// ── Localized enum labels ────────────────────────────────────────────────────

/**
 * Label helpers over the `trading.*` dictionary. Values come from the DB as
 * plain strings — unknown values degrade gracefully to an em dash.
 */
export function useTradingLabels() {
  const tRoot = useTranslations();
  return React.useMemo(() => {
    const pick = (path: string, v: string | null | undefined): string =>
      v ? tRoot(`${path}.${v}` as Parameters<typeof tRoot>[0]) : "—";
    return {
      direction: (v: string | null | undefined) => pick("trading.direction", v),
      orderType: (v: string | null | undefined) => pick("trading.orderType", v),
      status: (v: string | null | undefined) => pick("trading.status", v),
      session: (v: string | null | undefined) => pick("trading.session", v),
      result: (v: string | null | undefined) => pick("trading.result", v),
      exitReason: (v: string | null | undefined) => pick("trading.exitReason", v),
      emotion: (v: string | null | undefined) => pick("trading.emotion", v),
      marketCondition: (v: string | null | undefined) =>
        pick("trading.marketCondition", v),
      reviewStatus: (v: string | null | undefined) => pick("trading.reviewStatus", v),
      executionType: (v: string | null | undefined) =>
        pick("trading.executionType", v),
      screenshotLabel: (v: string | null | undefined) =>
        pick("trading.screenshotLabel", v),
      assetClass: (v: string | null | undefined) => pick("trading.assetClass", v),
      accountType: (v: string | null | undefined) => pick("trading.accountType", v),
    };
  }, [tRoot]);
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function DirectionBadge({
  direction,
  className,
}: {
  direction: string | null | undefined;
  className?: string;
}) {
  const labels = useTradingLabels();
  if (!direction) return null;
  const long = direction === "LONG";
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-medium tabular-nums ${
        long
          ? "border-gain-subtle text-gain"
          : "border-loss-subtle text-loss"
      } ${className ?? ""}`}
    >
      {long ? (
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
      )}
      {long ? "L" : "S"}
      <span className="sr-only">{labels.direction(direction)}</span>
    </Badge>
  );
}

export function ResultBadge({
  result,
  className,
}: {
  result: string | null | undefined;
  className?: string;
}) {
  const labels = useTradingLabels();
  if (!result) return null;
  const tone =
    result === "WIN"
      ? "border-gain-subtle bg-gain-subtle text-gain"
      : result === "LOSS"
        ? "border-loss-subtle bg-loss-subtle text-loss"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={`font-medium ${tone} ${className ?? ""}`}>
      {labels.result(result)}
    </Badge>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const labels = useTradingLabels();
  if (!status) return null;
  const tone =
    status === "OPEN"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : status === "PENDING"
        ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={`font-medium ${tone} ${className ?? ""}`}>
      {labels.status(status)}
    </Badge>
  );
}

export function DraftBadge({ className }: { className?: string }) {
  const t = useTranslations("common");
  return (
    <Badge
      variant="outline"
      className={`border-dashed border-foreground/30 text-muted-foreground ${className ?? ""}`}
    >
      {t("draft")}
    </Badge>
  );
}

export function TagsBadges({
  tags,
  max = 4,
  className,
}: {
  tags: TagDTO[];
  max?: number;
  className?: string;
}) {
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="max-w-28 truncate font-normal text-muted-foreground"
          style={{ borderColor: `${tag.color}66` }}
        >
          <span
            className="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
            aria-hidden="true"
          />
          {tag.name}
        </Badge>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-muted-foreground">+{rest}</span>
      )}
    </span>
  );
}

// ── Instruments ──────────────────────────────────────────────────────────────

/** API DTO → engine spec (structurally compatible — explicit for clarity). */
export function toSpec(dto: InstrumentApiDTO): InstrumentSpec & { id: string } {
  return {
    id: dto.id,
    symbol: dto.symbol,
    name: dto.name,
    assetClass: dto.assetClass,
    baseCurrency: dto.baseCurrency,
    quoteCurrency: dto.quoteCurrency,
    digits: dto.digits,
    pipSize: dto.pipSize,
    pointSize: dto.pointSize,
    contractSize: dto.contractSize,
    tickSize: dto.tickSize,
    tickValue: dto.tickValue,
  };
}

const ASSET_CLASS_ORDER = [
  "METAL",
  "FOREX",
  "INDEX",
  "CRYPTO",
  "COMMODITY",
  "STOCK",
  "FUTURES",
] as const;

/** Instruments grouped by asset class, favorites first inside each group. */
export function groupInstruments(
  instruments: InstrumentApiDTO[],
  favoriteIds: string[] = []
): Array<{ assetClass: string; items: InstrumentApiDTO[] }> {
  const fav = new Set(favoriteIds);
  return ASSET_CLASS_ORDER.map((assetClass) => ({
    assetClass,
    items: instruments
      .filter((i) => i.assetClass === assetClass)
      .sort((a, b) => {
        const fa = fav.has(a.id) ? 0 : 1;
        const fb = fav.has(b.id) ? 0 : 1;
        return fa !== fb ? fa - fb : a.symbol.localeCompare(b.symbol);
      }),
  })).filter((g) => g.items.length > 0);
}

// ── Reference selectors ──────────────────────────────────────────────────────

/**
 * Radix Select's hidden native select dispatches a synthetic "change" when
 * its value prop changes; when the matching <option> is not (yet) mounted,
 * the DOM value falls back to "" and onValueChange("") fires — wiping a
 * programmatically-set value. Our selects have no empty-valued items, so
 * empty notifications are always spurious and safe to ignore.
 *
 * Exported since v2 audit: every inline <Select> that writes form state
 * inside a <form> must wrap its onValueChange with this guard (the edit
 * prefill changes values programmatically → spurious "" otherwise wipes
 * status/session/etc. and blocks submission).
 */
export function guardEmpty(onChange: (value: string) => void) {
  return (value: string) => {
    if (value !== "") onChange(value);
  };
}

interface SelectPropsBase {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function AccountSelect({
  id = "select-account",
  value,
  onChange,
  disabled,
  className,
  onlyActive = true,
}: SelectPropsBase & { onlyActive?: boolean }) {
  const t = useTranslations("quick");
  const { data: accounts, isLoading } = useAccounts();
  const labels = useTradingLabels();
  const list = (accounts ?? []).filter((a) => (onlyActive ? a.isActive : true));

  return (
    <Select
      value={value}
      onValueChange={guardEmpty(onChange)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "…" : t("account")} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {list.map((a: AccountDTO) => (
          <SelectItem key={a.id} value={a.id}>
            <span className="font-medium">{a.name}</span>
            <span className="ml-2 text-muted-foreground">
              {labels.accountType(a.type)} · {a.currency}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InstrumentSelect({
  id = "select-instrument",
  value,
  onChange,
  disabled,
  className,
  favoriteIds = [],
}: SelectPropsBase & { favoriteIds?: string[] }) {
  const t = useTranslations("quick");
  const { data: instruments, isLoading } = useInstruments();
  const labels = useTradingLabels();
  const groups = React.useMemo(
    () => groupInstruments(instruments ?? [], favoriteIds),
    [instruments, favoriteIds]
  );

  return (
    <Select
      value={value}
      onValueChange={guardEmpty(onChange)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "…" : t("instrument")} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {groups.map((group) => (
          <SelectGroup key={group.assetClass}>
            <SelectLabel>{labels.assetClass(group.assetClass)}</SelectLabel>
            {group.items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                <span className="font-medium tabular-nums">{i.symbol}</span>
                <span className="ml-2 text-muted-foreground">{i.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StrategySelect({
  id = "select-strategy",
  value,
  onChange,
  disabled,
  className,
  noneLabel,
}: SelectPropsBase & { noneLabel: string }) {
  const { data: strategies, isLoading } = useStrategies();

  return (
    <Select
      value={value}
      onValueChange={guardEmpty(onChange)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={isLoading ? "…" : noneLabel} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {strategies?.map((s: StrategyDTO) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              <span className="font-medium">{s.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TimeframeSelect({
  id = "select-timeframe",
  value,
  onChange,
  disabled,
  className,
}: SelectPropsBase) {
  const t = useTranslations("quick");
  return (
    <Select value={value} onValueChange={guardEmpty(onChange)} disabled={disabled}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={t("timeframe")}>{value || t("timeframe")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TIMEFRAMES.map((tf) => (
          <SelectItem key={tf} value={tf}>
            {tf}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Form rows ────────────────────────────────────────────────────────────────

/** Label + control in a consistent grid row (used by the trade forms). */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
