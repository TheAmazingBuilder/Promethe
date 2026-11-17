"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  CandlestickChart,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Download } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/components/app/session-context";
import { Money, Sensitive } from "@/components/privacy/money";
import { useI18n } from "@/i18n/i18n-provider";
import {
  DirectionBadge,
  DraftBadge,
  ResultBadge,
  StatusBadge,
  TagsBadges,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { useToast } from "@/hooks/use-toast";
import {
  useAccounts,
  useCreateSavedView,
  useDeleteSavedView,
  useDeleteTrade,
  useSavedViews,
  useStrategies,
  useTradesList,
} from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import {
  fmtDateTimeInTz,
  fmtNum,
  fmtPrice,
  fmtSigned,
  pnlClass,
} from "@/lib/format";
import { useFormat } from "@/lib/format/use-format";
import { apiErrorMessage } from "@/lib/i18n-errors";
import { navigate, parseHash } from "@/lib/router";
import type { SavedViewDTO, TradeListItemDTO } from "@/lib/trading/dto";
import {
  DIRECTIONS,
  RESULT_TYPES,
  TRADE_STATUSES,
  TRADING_SESSIONS,
} from "@/lib/trading/types";
import type { TradeListQuery } from "@/lib/validations/trade";

const DEFAULT_QUERY: TradeListQuery = {
  page: 1,
  pageSize: 25,
  sort: "entryTime",
  order: "desc",
  includeDrafts: false,
};

type SortKey = "entryTime" | "exitTime" | "netPnl" | "rMultiple";

/** v2.5 M2 - chart drill-down: apply #/trades?… filters once on mount. */
function drillFiltersFromHash(): Partial<TradeListQuery> | null {
  if (typeof window === "undefined") return null;
  const route = parseHash(window.location.hash);
  if (route.view !== "trades") return null;
  const q = route.query ?? {};
  const patch: Partial<TradeListQuery> = {};
  let any = false;
  const set = <K extends keyof TradeListQuery>(key: K, value: TradeListQuery[K]) => {
    patch[key] = value;
    any = true;
  };
  if (q.symbol) set("symbol", q.symbol);
  if (q.direction === "LONG" || q.direction === "SHORT") {
    set("direction", q.direction);
  }
  if (q.session) set("session", q.session as TradeListQuery["session"]);
  if (q.timeframe) set("timeframe", q.timeframe as TradeListQuery["timeframe"]);
  if (q.emotion) set("emotion", q.emotion as TradeListQuery["emotion"]);
  if (q.search) set("search", q.search);
  if (q.resultType) {
    set("resultType", q.resultType as TradeListQuery["resultType"]);
  }
  if (q.dateFrom) set("dateFrom", q.dateFrom);
  if (q.dateTo) set("dateTo", q.dateTo);
  if (q.entryHour != null && /^\d{1,2}$/.test(q.entryHour)) {
    set("entryHour", Number(q.entryHour));
  }
  if (q.entryWeekday != null && /^[1-7]$/.test(q.entryWeekday)) {
    set("entryWeekday", Number(q.entryWeekday));
  }
  return any ? patch : null;
}

/** Trades journal - server-side filters, saved views, sortable paginated table. */
export function TradesView() {
  const t = useTranslations("trades.list");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const { locale } = useI18n();
  const labels = useTradingLabels();
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";
  const { toast } = useToast();

  const [query, setQuery] = React.useState<TradeListQuery>(DEFAULT_QUERY);
  const [searchInput, setSearchInput] = React.useState("");
  const [showMore, setShowMore] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [viewName, setViewName] = React.useState("");
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<TradeListItemDTO | null>(null);
  // v2.5 M2 — chart drill-down filters arrive as #/trades?… query params.
  const [drillApplied, setDrillApplied] = React.useState(false);

  React.useEffect(() => {
    if (drillApplied) return;
    const drill = drillFiltersFromHash();
    if (drill) {
      setQuery((q) => ({ ...q, ...drill, page: 1 }));
      if (drill.search) setSearchInput(drill.search);
    }
    setDrillApplied(true);
  }, [drillApplied]);

  const trades = useTradesList(query);
  const accounts = useAccounts();
  const strategies = useStrategies();
  const savedViews = useSavedViews("trades");
  const createView = useCreateSavedView();
  const deleteView = useDeleteSavedView();
  const deleteTrade = useDeleteTrade();

  const data = trades.data;
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? query.page;

  // Debounced search (~300 ms) — resets to page 1 when the term changes.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchInput.trim() || undefined;
      setQuery((q) => (q.search === next ? q : { ...q, search: next, page: 1 }));
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Keep the page in range when the result set shrinks.
  React.useEffect(() => {
    if (data && data.totalPages > 0 && query.page > data.totalPages) {
      setQuery((q) => ({ ...q, page: 1 }));
    }
  }, [data, query.page]);

  const hasActiveFilters = React.useMemo(
    () =>
      Boolean(
        query.search ||
          query.status ||
          query.direction ||
          query.resultType ||
          query.reviewStatus ||
          query.session ||
          query.accountId ||
          query.strategyId ||
          query.instrumentId ||
          query.symbol ||
          query.tagId ||
          query.emotion ||
          query.dateFrom ||
          query.dateTo ||
          query.includeDrafts ||
          query.entryHour != null ||
          query.entryWeekday != null
      ),
    [query]
  );

  const setFilter = (patch: Partial<TradeListQuery>) => {
    setActiveViewId(null);
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  };

  const resetFilters = () => {
    setActiveViewId(null);
    setSearchInput("");
    setQuery({ ...DEFAULT_QUERY });
  };

  const onSort = (key: SortKey) => {
    setQuery((q) =>
      q.sort === key
        ? { ...q, order: q.order === "asc" ? "desc" : "asc" }
        : { ...q, sort: key, order: "desc", page: 1 }
    );
  };

  const mutationErrorToast = (err: unknown) => {
    const e = err as ApiClientError;
    toast({
      title: apiErrorMessage(
        tRoot,
        e?.code,
        err instanceof Error ? err.message : ""
      ),
      variant: "destructive",
    });
  };

  const applyView = (view: SavedViewDTO) => {
    setActiveViewId(view.id);
    const filters = view.filters as Partial<TradeListQuery>;
    setSearchInput(typeof filters.search === "string" ? filters.search : "");
    setQuery({ ...DEFAULT_QUERY, ...filters, page: 1 });
  };

  const saveCurrentView = () => {
    const name = viewName.trim();
    if (!name) return;
    const filters: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(query)) {
      if (["page", "pageSize", "sort", "order"].includes(key)) continue;
      if (value !== undefined && value !== null && value !== "") {
        filters[key] = value;
      }
    }
    createView.mutate(
      { page: "trades", name, filters },
      {
        onSuccess: () => {
          toast({ title: t("viewSaved") });
          setSaveOpen(false);
          setViewName("");
        },
        onError: mutationErrorToast,
      }
    );
  };

  const removeView = (view: SavedViewDTO) => {
    deleteView.mutate(view, {
      onSuccess: () => {
        if (activeViewId === view.id) setActiveViewId(null);
        toast({ title: t("viewDeleted") });
      },
      onError: mutationErrorToast,
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteTrade.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: t("deletedToast") });
        setDeleteTarget(null);
      },
      onError: mutationErrorToast,
    });
  };

  const views = savedViews.data ?? [];
  const loading = trades.isLoading;

  /** CSV export of the CURRENT filters (phase 6) - same where-clause server-side.
   * v2.5 Module 8: privacy mode is display-only, so the export still contains
   * REAL values — the user gets a clear warning before downloading (§3.1). */
  const [exporting, setExporting] = React.useState(false);
  const [privacyExportOpen, setPrivacyExportOpen] = React.useState(false);
  const onExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ lang: locale });
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === "" || key === "page") continue;
        // includeDrafts/sort/order already match the query param contract.
        params.set(key, String(value));
      }
      const res = await fetch(`/api/trades/export?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`export ${res.status}`);
      }
      const count = res.headers.get("X-Trades-Count");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "trades.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: t("exportedToast", { count: count ?? "?" }),
      });
    } catch {
      toast({ title: t("exportFailedToast"), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // Privacy mode active → warn before exporting real values.
  const fmt = useFormat();
  const requestExport = () => {
    if (fmt.privacyMode !== "OFF") {
      setPrivacyExportOpen(true);
      return;
    }
    void onExportCsv();
  };

  return (
    <div className="space-y-4" data-tour="trades">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {/* a11y (M8 Phase 5): flex-wrap keeps the header reflow-safe at
            200 % text scale / 320 px (WCAG 1.4.10). */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            aria-label={t("exportCsv")}
            onClick={requestExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{t("exportCsv")}</span>
          </Button>
          <Button
            variant="outline"
            aria-label={t("quick")}
            onClick={() => navigate("#/trades/quick")}
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("quick")}</span>
          </Button>
          <Button onClick={() => navigate("#/trades/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("new")}
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="trades-search">{tCommon("search")}</Label>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="trades-search"
                  placeholder={t("searchPlaceholder")}
                  className="pl-8"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
            </div>

            <FilterSelect
              id="filter-status"
              label={t("status")}
              value={query.status}
              options={TRADE_STATUSES.map((s) => ({
                value: s,
                label: labels.status(s),
              }))}
              onChange={(v) => setFilter({ status: v })}
            />
            <FilterSelect
              id="filter-direction"
              label={t("direction")}
              value={query.direction}
              options={DIRECTIONS.map((d) => ({
                value: d,
                label: labels.direction(d),
              }))}
              onChange={(v) => setFilter({ direction: v })}
            />
            <FilterSelect
              id="filter-result"
              label={t("result")}
              value={query.resultType}
              options={RESULT_TYPES.map((r) => ({
                value: r,
                label: labels.result(r),
              }))}
              onChange={(v) => setFilter({ resultType: v })}
            />
            <FilterSelect
              id="filter-session"
              label={t("session")}
              value={query.session}
              options={TRADING_SESSIONS.map((s) => ({
                value: s,
                label: labels.session(s),
              }))}
              onChange={(v) => setFilter({ session: v })}
            />

            {showMore && (
              <>
                <FilterSelect
                  id="filter-account"
                  label={t("account")}
                  value={query.accountId}
                  options={(accounts.data ?? []).map((a) => ({
                    value: a.id,
                    label: a.name,
                  }))}
                  onChange={(v) => setFilter({ accountId: v })}
                />
                <FilterSelect
                  id="filter-strategy"
                  label={t("strategy")}
                  value={query.strategyId}
                  options={(strategies.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                  onChange={(v) => setFilter({ strategyId: v })}
                />
                <FilterSelect
                  id="filter-review"
                  label={t("reviewStatus")}
                  value={query.reviewStatus}
                  options={[
                    { value: "REVIEWED", label: labels.reviewStatus("REVIEWED") },
                    {
                      value: "NOT_REVIEWED",
                      label: labels.reviewStatus("NOT_REVIEWED"),
                    },
                  ]}
                  onChange={(v) => setFilter({ reviewStatus: v })}
                />
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2">
                  <Label
                    htmlFor="filter-drafts"
                    className="cursor-pointer font-normal"
                  >
                    {t("includeDrafts")}
                  </Label>
                  <Switch
                    id="filter-drafts"
                    checked={query.includeDrafts}
                    onCheckedChange={(v) => setFilter({ includeDrafts: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-from">{t("from")}</Label>
                  <Input
                    id="filter-from"
                    type="date"
                    value={query.dateFrom ?? ""}
                    onChange={(e) =>
                      setFilter({ dateFrom: e.target.value || undefined })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-to">{t("to")}</Label>
                  <Input
                    id="filter-to"
                    type="date"
                    value={query.dateTo ?? ""}
                    onChange={(e) =>
                      setFilter({ dateTo: e.target.value || undefined })
                    }
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
            >
              {showMore ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {showMore ? tCommon("fewer") : tCommon("more")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={resetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Saved views ── */}
      {(views.length > 0 || hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title={views.length === 0 ? t("noViews") : undefined}
          >
            {t("views")}
          </span>
          {views.map((view) => (
            <span
              key={view.id}
              className="inline-flex overflow-hidden rounded-md border"
            >
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-none border-0 px-2 text-xs font-normal"
                title={t("applyView")}
                onClick={() => applyView(view)}
              >
                <Bookmark
                  className={`h-3.5 w-3.5 ${
                    activeViewId === view.id ? "text-gain" : "text-muted-foreground"
                  }`}
                  aria-hidden="true"
                />
                {view.name}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 rounded-none border-0 border-l px-0 text-muted-foreground hover:text-destructive"
                aria-label={t("deleteView")}
                disabled={deleteView.isPending}
                onClick={() => removeView(view)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </span>
          ))}
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => {
                setViewName("");
                setSaveOpen(true);
              }}
            >
              <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("saveView")}
            </Button>
          )}
        </div>
      )}

      {/* ── Count ── */}
      {!loading && !trades.isError && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t("count", { count: total })}
          </p>
          {query.includeDrafts && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              {t("draftsShown")}
            </Badge>
          )}
          {/* v2.5 M2 — chart drill-down chips (TZ-aware local filters) */}
          {query.timeframe != null && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {t("drillTimeframe", { tf: query.timeframe })}
              <button
                type="button"
                aria-label={t("removeFilter")}
                className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() =>
                  setQuery((q) => ({ ...q, timeframe: undefined, page: 1 }))
                }
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          )}
          {query.entryHour != null && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {t("drillHour", { hour: query.entryHour })}
              <button
                type="button"
                aria-label={t("removeFilter")}
                className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() =>
                  setQuery((q) => ({ ...q, entryHour: undefined, page: 1 }))
                }
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          )}
          {query.entryWeekday != null && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {t("drillWeekday", {
                day: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
                  new Date(2024, 0, 7 + query.entryWeekday) // 2024-01-08 = Monday
                ),
              })}
              <button
                type="button"
                aria-label={t("removeFilter")}
                className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() =>
                  setQuery((q) => ({ ...q, entryWeekday: undefined, page: 1 }))
                }
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* ── Body ── */}
      {loading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : trades.isError ? (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle
                className="h-8 w-8 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">{t("loadError")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void trades.refetch()}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {tCommon("retry")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        hasActiveFilters ? (
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Search
                  className="h-8 w-8 text-muted-foreground/60"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p className="font-medium">{t("noResultsTitle")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("noResultsDesc")}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("reset")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="rounded-full bg-muted p-3">
                  <CandlestickChart
                    className="h-6 w-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">{t("emptyTitle")}</p>
                  <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                    {t("emptyDesc")}
                  </p>
                </div>
                <Button onClick={() => navigate("#/trades/quick")}>
                  <Zap className="h-4 w-4" aria-hidden="true" />
                  {t("emptyCta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="whitespace-nowrap">
                  <SortButton
                    label={t("colDate")}
                    active={query.sort === "entryTime"}
                    order={query.order}
                    ariaLabel={t("sortAria", { column: t("colDate") })}
                    onClick={() => onSort("entryTime")}
                  />
                </TableHead>
                <TableHead>{t("colSymbol")}</TableHead>
                <TableHead>{t("colDirection")}</TableHead>
                <TableHead className="text-right">{t("colLots")}</TableHead>
                <TableHead className="hidden text-right lg:table-cell">
                  {t("colEntry")}
                </TableHead>
                <TableHead className="hidden text-right lg:table-cell">
                  <SortButton
                    label={t("colExit")}
                    active={query.sort === "exitTime"}
                    order={query.order}
                    ariaLabel={t("sortAria", { column: t("colExit") })}
                    onClick={() => onSort("exitTime")}
                  />
                </TableHead>
                <TableHead className="text-right">{t("colPips")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  <SortButton
                    label={t("colR")}
                    active={query.sort === "rMultiple"}
                    order={query.order}
                    ariaLabel={t("sortAria", { column: t("colR") })}
                    onClick={() => onSort("rMultiple")}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton
                    label={t("colPnl")}
                    active={query.sort === "netPnl"}
                    order={query.order}
                    ariaLabel={t("sortAria", { column: t("colPnl") })}
                    onClick={() => onSort("netPnl")}
                  />
                </TableHead>
                <TableHead>{t("colResult")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("colAccount")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("colStrategy")}
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  {t("colSession")}
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  {t("colTimeframe")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("colReview")}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((trade) => (
                <TableRow
                  key={trade.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`#/trades/${trade.id}`)}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fmtDateTimeInTz(trade.entryTime, timezone)}
                  </TableCell>
                  <TableCell className="max-w-[12rem]">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium tabular-nums">
                        {trade.symbol}
                      </span>
                      <TagsBadges tags={trade.tags} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <DirectionBadge direction={trade.direction} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Sensitive kind="lots">{fmtNum(trade.lots)}</Sensitive>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {fmtPrice(trade.entryPrice, trade.digits)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {fmtPrice(trade.exitPrice, trade.digits)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${pnlClass(trade.pips)}`}
                  >
                    {fmtSigned(trade.pips)}
                  </TableCell>
                  <TableCell
                    className={`hidden text-right tabular-nums md:table-cell ${pnlClass(trade.rMultiple)}`}
                  >
                    {fmtSigned(trade.rMultiple, 2, 2)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <Money
                      signed
                      value={trade.netPnl}
                      currency={trade.pnlCurrency}
                      className={pnlClass(trade.netPnl)}
                    />
                  </TableCell>
                  <TableCell>
                    {trade.resultType ? (
                      <ResultBadge result={trade.resultType} />
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={trade.status} />
                      {trade.isDraft && <DraftBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    <Sensitive kind="account">{trade.accountName}</Sensitive>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {trade.strategyName ?? "-"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">
                    {labels.session(trade.session)}
                  </TableCell>
                  <TableCell className="hidden tabular-nums xl:table-cell">
                    {trade.timeframe ?? "-"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span
                      className="inline-flex"
                      title={labels.reviewStatus(trade.reviewStatus)}
                    >
                      {trade.reviewStatus === "REVIEWED" ? (
                        <CheckCircle2
                          className="h-4 w-4 text-gain"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="h-4 w-4 text-muted-foreground/50"
                          aria-hidden="true"
                        />
                      )}
                      <span className="sr-only">
                        {labels.reviewStatus(trade.reviewStatus)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell
                    className="w-10 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("rowMenu")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => navigate(`#/trades/${trade.id}`)}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          {t("view")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(`#/trades/${trade.id}/edit`)
                          }
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          {t("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                          onClick={() => setDeleteTarget(trade)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Pagination ── */}
      {!loading && !trades.isError && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("page", { page: currentPage, totalPages })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() =>
                setQuery((q) => ({ ...q, page: Math.max(1, q.page - 1) }))
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("prev")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t("next")}</span>
            </Button>
          </div>
        </div>
      )}

      {/* ── Save-view dialog ── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("saveView")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("viewName")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="view-name">{t("viewName")}</Label>
            <Input
              id="view-name"
              placeholder={t("viewNamePlaceholder")}
              value={viewName}
              maxLength={60}
              onChange={(e) => setViewName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={createView.isPending}
              onClick={() => setSaveOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!viewName.trim() || createView.isPending}
              onClick={saveCurrentView}
            >
              {createView.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTrade.isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTrade.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleteTrade.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── v2.5 Module 8: privacy-mode export warning (§3.1) ── */}
      <AlertDialog open={privacyExportOpen} onOpenChange={setPrivacyExportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("privacyExportTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("privacyExportDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPrivacyExportOpen(false);
                void onExportCsv();
              }}
            >
              {t("privacyExportConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────────────────────────

/** Enum-like filter select with an implicit "all" (undefined) option. */
function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T | undefined) => void;
}) {
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? "all"}
        onValueChange={(v) => onChange(v === "all" ? undefined : (v as T))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="all">{tCommon("all")}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Sortable table-header button (server-side sort + order toggle). */
function SortButton({
  label,
  active,
  order,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  order: "asc" | "desc";
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`-ml-2 h-7 gap-1 px-2 text-xs font-medium ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {label}
      {active ? (
        order === "asc" ? (
          <ArrowUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      )}
    </Button>
  );
}
