"use client";

/**
 * FocusView (v2.5 Module 1, spec §2) — distraction-free trading mode (/focus).
 *
 * A centered, low-chrome column inside the app shell: big clock in the
 * profile timezone, open session badges, and CONFIGURABLE blocks (rules,
 * remaining risk, prop limits, open trades, quick actions, plan note) driven
 * by appearance.focusModeConfig. Amounts can be hidden (R-only / bullets).
 * The plan note persists to localStorage (no API) — debounced autosave.
 */
import * as React from "react";
import {
  Check,
  NotebookPen,
  Settings2,
  ShieldCheck,
  Target,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAppearanceContext,
} from "@/components/app/appearance-provider";
import { useSession } from "@/components/app/session-context";
import { Money } from "@/components/privacy/money";
import { DirectionBadge } from "@/components/trades/trade-bits";
import { usePropStatus } from "@/hooks/use-journal";
import { useRules } from "@/hooks/use-goals";
import { useTradesList } from "@/hooks/use-trading";
import { useToast } from "@/hooks/use-toast";
import {
  FOCUS_BLOCKS,
  parseFocusBlocks,
  type FocusBlock,
} from "@/lib/dashboard/appearance";
import { fmtTimeInTz, pnlClass } from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { SESSION_RANGES_UTC } from "@/lib/trading/session";
import type { TradingSession } from "@/lib/trading/types";
import { toD } from "@/lib/trading/dec";

const PLAN_KEY = "tj_focus_plan";
const PLAN_DEBOUNCE_MS = 600;

/** Sessions whose UTC range contains the current hour. */
function openSessions(now: Date): TradingSession[] {
  const h = now.getUTCHours();
  return (Object.keys(SESSION_RANGES_UTC) as TradingSession[]).filter(
    (session) => {
      const [start, end] = SESSION_RANGES_UTC[session];
      return h >= start && h < end;
    }
  );
}

/** "3 h 20" style elapsed since an ISO instant (locale-free, compact). */
function elapsedSince(iso: string): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  );
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function RulesBlock() {
  const t = useTranslations("focus");
  const tRules = useTranslations("goalsView.rules");
  const rules = useRules();
  const active = (rules.data ?? []).filter((r) => r.isActive);

  if (rules.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }
  if (active.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("rulesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {active.map((rule) => (
            <li key={rule.id} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-gain" aria-hidden="true" />
              <span>
                <span className="font-medium">
                  {tRules(`kind.${rule.kind}`)}
                </span>
                {rule.description ? (
                  <span className="text-muted-foreground">
                    {" "}
                    - {rule.description}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RiskBlock({ hideAmounts }: { hideAmounts: boolean }) {
  const t = useTranslations("focus");
  const fmt = useFormat();
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const prop = usePropStatus();
  const rules = useRules();

  const maxTradesRule = (rules.data ?? []).find(
    (r) => r.isActive && r.kind === "MAX_TRADES_PER_DAY"
  );

  // Trades opened today (profile tz) — derived from the open+closed list.
  const timezone = session?.profile.timezone ?? "UTC";
  const todayIso = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, [timezone]);
  const tradesToday = useTradesList({
    page: 1,
    pageSize: 100,
    sort: "entryTime",
    order: "desc",
    includeDrafts: false,
    dateFrom: `${todayIso}T00:00:00`,
  });

  if (prop.isLoading && rules.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  const status = prop.data?.status ?? null;
  const dailyLoss = status?.dailyLoss;
  const hasDailyLoss = dailyLoss?.limitAmount != null;
  const tradesCount = maxTradesRule ? (tradesToday.data?.total ?? 0) : null;

  if (!hasDailyLoss && tradesCount == null) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("riskTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasDailyLoss && dailyLoss?.limitAmount != null ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{t("dailyLossUsed")}</span>
              <span className="tabular-nums text-muted-foreground">
                {hideAmounts
                  ? t("amountHidden")
                  : t("dailyLossAmount", {
                      used: fmt.money(dailyLoss.used, currency),
                      limit: fmt.money(dailyLoss.limitAmount, currency),
                    })}
              </span>
            </div>
            <Progress
              value={Math.min(100, Number(dailyLoss.usedPercent ?? 0))}
              aria-label={t("dailyLossUsed")}
            />
            <p
              className={`text-xs tabular-nums ${
                dailyLoss.status === "BREACHED" ? "text-loss" : "text-gain"
              }`}
            >
              {hideAmounts
                ? `${Math.min(100, Number(dailyLoss.usedPercent ?? 0)).toFixed(0)} %`
                : dailyLoss.remaining != null && toD(dailyLoss.remaining).lt(0)
                  ? t("overLimit", {
                      amount: fmt.money(
                        toD(dailyLoss.remaining).neg(),
                        currency
                      ),
                    })
                  : t("remaining", {
                      amount: fmt.money(dailyLoss.remaining ?? "0", currency),
                    })}
            </p>
          </div>
        ) : null}
        {tradesCount != null && maxTradesRule ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{t("tradesToday")}</span>
              <span
                className={`tabular-nums ${
                  tradesCount > Number(maxTradesRule.value)
                    ? "text-loss"
                    : "text-muted-foreground"
                }`}
              >
                {tradesCount} / {Number(maxTradesRule.value)}
              </span>
            </div>
            <Progress
              value={Math.min(
                100,
                (tradesCount / Math.max(1, Number(maxTradesRule.value))) * 100
              )}
              aria-label={t("tradesToday")}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PropBlock({ hideAmounts }: { hideAmounts: boolean }) {
  const t = useTranslations("focus");
  const fmt = useFormat();
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const prop = usePropStatus();

  if (prop.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  const status = prop.data?.status ?? null;
  if (!prop.data?.account || !status) return null;

  const dd = status.totalDrawdown;
  const target = status.profitTarget;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <Target className="h-4 w-4" aria-hidden="true" />
          {t("propTitle", { name: prop.data.account.name })}
        </CardTitle>
        <CardDescription className="tabular-nums">
          {hideAmounts
            ? t("amountHidden")
            : t("propEquity", {
                equity: fmt.money(status.currentEquity, currency),
              })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {dd.limitAmount != null ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{t("propDrawdown")}</span>
              <span className="tabular-nums text-muted-foreground">
                {hideAmounts
                  ? `${Math.min(100, Number(dd.usedPercent ?? 0)).toFixed(0)} %`
                  : (
                      <>
                        <Money value={dd.used} currency={currency} /> /{" "}
                        <Money value={dd.limitAmount} currency={currency} />
                      </>
                    )}
              </span>
            </div>
            <Progress
              value={Math.min(100, Number(dd.usedPercent ?? 0))}
              aria-label={t("propDrawdown")}
            />
          </div>
        ) : null}
        {target.targetAmount != null ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{t("propTarget")}</span>
              <span className="tabular-nums text-muted-foreground">
                {hideAmounts
                  ? `${Math.min(
                      100,
                      Number(target.progressPercent ?? 0)
                    ).toFixed(0)} %`
                  : (
                      <>
                        <Money value={target.gained} currency={currency} /> /{" "}
                        <Money value={target.targetAmount} currency={currency} />
                      </>
                    )}
              </span>
            </div>
            <Progress
              value={Math.min(100, Number(target.progressPercent ?? 0))}
              aria-label={t("propTarget")}
            />
            <p
              className={`text-xs tabular-nums ${
                target.reached ? "text-gain" : "text-muted-foreground"
              }`}
            >
              {target.reached
                ? t("propTargetReached")
                : hideAmounts
                  ? t("amountHidden")
                  : t("propTargetRemaining", {
                      amount: fmt.money(target.remaining ?? "0", currency),
                    })}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenTradesBlock({ hideAmounts }: { hideAmounts: boolean }) {
  const t = useTranslations("focus");
  const { session } = useSession();
  const currency = session?.profile.baseCurrency ?? "USD";
  const trades = useTradesList({
    page: 1,
    pageSize: 20,
    sort: "entryTime",
    order: "desc",
    includeDrafts: false,
    status: "OPEN",
  });

  if (trades.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = trades.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("openTradesTitle", { count: rows.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rows.map((trade) => {
            const rText =
              trade.rMultiple != null
                ? `${toD(trade.rMultiple).gt(0) ? "+" : ""}${toD(
                    trade.rMultiple
                  ).toFixed(1)} R`
                : null;
            return (
              <li key={trade.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/trades/${trade.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <DirectionBadge direction={trade.direction} />
                    <span className="truncate font-semibold tabular-nums">
                      {trade.symbol}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {elapsedSince(trade.entryTime)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm">
                    {rText ? (
                      <span
                        className={`font-medium tabular-nums ${pnlClassForR(
                          trade.rMultiple
                        )}`}
                      >
                        {rText}
                      </span>
                    ) : null}
                    {hideAmounts ? (
                      <span className="font-semibold tabular-nums text-muted-foreground">
                        •••
                      </span>
                    ) : (
                      <Money
                        signed
                        value={trade.netPnl}
                        currency={currency}
                        className={`font-semibold ${pnlClass(trade.netPnl)}`}
                      />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function pnlClassForR(rMultiple: string | null): string {
  if (rMultiple == null) return "text-muted-foreground";
  const d = toD(rMultiple);
  if (d.gt(0)) return "text-gain";
  if (d.lt(0)) return "text-loss";
  return "text-muted-foreground";
}

function SessionBlock({ now }: { now: Date }) {
  const t = useTranslations("focus");
  const tTrading = useTranslations("trading");
  const open = openSessions(now);
  if (open.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-xs text-muted-foreground">{t("sessionsOpen")}</span>
      {open.map((session) => (
        <Badge
          key={session}
          variant="outline"
          className="border-gain-subtle bg-gain-subtle text-gain"
        >
          {tTrading(`session.${session}`)}
        </Badge>
      ))}
    </div>
  );
}

function ActionsBlock() {
  const t = useTranslations("focus");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Button
        size="lg"
        className="h-14 text-base"
        onClick={() => navigate("/trades/quick")}
      >
        <Zap className="h-5 w-5" aria-hidden="true" />
        {t("actionQuickTrade")}
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-14 text-base"
        onClick={() => navigate("/trades")}
      >
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        {t("actionCloseTrade")}
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-14 text-base"
        onClick={() => navigate("/journal")}
      >
        <NotebookPen className="h-5 w-5" aria-hidden="true" />
        {t("actionLogNote")}
      </Button>
    </div>
  );
}

function PlanNoteBlock() {
  const t = useTranslations("focus");
  const [value, setValue] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  // Load once on mount (after hydration — no SSR mismatch).
  React.useEffect(() => {
    setValue(window.localStorage.getItem(PLAN_KEY) ?? "");
  }, []);

  // Debounced autosave.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      window.localStorage.setItem(PLAN_KEY, value);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }, PLAN_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [value]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("planTitle")}
          <span
            className={`text-[10px] normal-case transition-opacity ${
              saved ? "opacity-100 text-gain" : "opacity-0"
            }`}
            aria-live="polite"
          >
            {t("planSaved")}
          </span>
        </CardTitle>
        <CardDescription>{t("planDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="sr-only" htmlFor="focus-plan">
          {t("planTitle")}
        </label>
        <textarea
          id="focus-plan"
          className="min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("planPlaceholder")}
          maxLength={4000}
        />
      </CardContent>
    </Card>
  );
}

// ── Configure popover ────────────────────────────────────────────────────────

function ConfigurePopover() {
  const t = useTranslations("focus");
  const { appearance, setAppearance } = useAppearanceContext();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  const blocks = parseFocusBlocks(appearance?.focusModeConfig?.blocks);
  const hideAmounts = appearance?.focusModeConfig?.hideAmounts === true;

  const save = (nextBlocks: FocusBlock[], nextHide: boolean) => {
    setAppearance({
      focusModeConfig: {
        hideAmounts: nextHide,
        blocks: nextBlocks.length > 0 ? nextBlocks : [...FOCUS_BLOCKS],
      },
    });
  };

  const toggleBlock = (block: FocusBlock, checked: boolean) => {
    const next = checked
      ? FOCUS_BLOCKS.filter(
          (b) => blocks.includes(b) || b === block
        )
      : blocks.filter((b) => b !== block);
    save(next, hideAmounts);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("configure")}
          title={t("configure")}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-sm font-medium">{t("configureBlocks")}</p>
        <div className="space-y-2">
          {FOCUS_BLOCKS.map((block) => (
            <label
              key={block}
              className="flex cursor-pointer items-center justify-between gap-2 text-sm"
            >
              <span>{t(`block.${block}`)}</span>
              <Checkbox
                checked={blocks.includes(block)}
                onCheckedChange={(checked) =>
                  toggleBlock(block, checked === true)
                }
                aria-label={t(`block.${block}`)}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
          <label
            htmlFor="focus-hide-amounts"
            className="cursor-pointer text-sm"
          >
            {t("hideAmounts")}
          </label>
          <Switch
            id="focus-hide-amounts"
            checked={hideAmounts}
            onCheckedChange={(checked) => {
              save(blocks, checked);
              toast({ title: t("configureSaved") });
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function FocusView() {
  const t = useTranslations("focus");
  const tTrading = useTranslations("trading");
  const { session } = useSession();
  const { appearance } = useAppearanceContext();
  const timezone = session?.profile.timezone ?? "UTC";
  const now = useNow(1000);

  const blocks = parseFocusBlocks(appearance?.focusModeConfig?.blocks);
  const hideAmounts = appearance?.focusModeConfig?.hideAmounts === true;

  const clock = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(now);
    } catch {
      return now.toLocaleTimeString();
    }
  }, [now, timezone]);

  const dateLabel = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now);
    } catch {
      return now.toLocaleDateString();
    }
  }, [now, timezone]);

  const currentSession = (() => {
    const h = now.getUTCHours();
    for (const key of Object.keys(SESSION_RANGES_UTC) as TradingSession[]) {
      const [start, end] = SESSION_RANGES_UTC[key];
      if (h >= start && h < end) return key;
    }
    return null;
  })();

  const show = (block: FocusBlock) => blocks.includes(block);

  return (
    <div className="w-full space-y-6">
      {/* Chrome: exit + configure */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => navigate("/")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {t("exit")}
        </Button>
        <ConfigurePopover />
      </div>

      {/* Clock */}
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <p
          className="text-5xl font-bold tabular-nums tracking-tight sm:text-6xl"
          aria-live="off"
        >
          {clock}
        </p>
        <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        {currentSession ? (
          <Badge variant="secondary" className="mt-1">
            {tTrading(`session.${currentSession}`)}
          </Badge>
        ) : null}
      </div>

      {show("session") ? <SessionBlock now={now} /> : null}
      {show("actions") ? <ActionsBlock /> : null}
      {show("rules") ? <RulesBlock /> : null}
      {show("risk") ? <RiskBlock hideAmounts={hideAmounts} /> : null}
      {show("prop") ? <PropBlock hideAmounts={hideAmounts} /> : null}
      {show("openTrades") ? (
        <OpenTradesBlock hideAmounts={hideAmounts} />
      ) : null}
      {show("planNote") ? <PlanNoteBlock /> : null}
    </div>
  );
}
