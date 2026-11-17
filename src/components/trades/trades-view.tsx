"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  AlertTriangle,
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
  Columns3,
  Copy,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Star,
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { DateField } from "@/components/ui/date-field";
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
import { ToastAction } from "@/components/ui/toast";
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
  useAdvancedAnalytics,
  useCreateSavedView,
  useDeleteSavedView,
  useDeleteTrade,
  useDuplicateSavedView,
  useSavedViews,
  useStrategies,
  useTags,
  useTradesList,
  useUpdateSavedView,
} from "@/hooks/use-trading";
import {
  useBulkTrades,
  useCustomFields,
  useSaveTableColumns,
  useTableColumns,
  useUndoGroup,
} from "@/hooks/use-productivity";
import { formatCustomFieldValue } from "@/lib/custom-fields/validate";
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

/**
 * Trades table columns (v2.5 Module 4 §4.8) — stable ids, persisted via
 * TableColumnPreference (tableKey "trades"). Custom-field columns
 * ("cf:<key>") are appended for definitions flagged showInTable.
 */
interface TradeColumnDef {
  id: string;
  labelKey: string;
  className?: string;
  cellClassName?: string;
  sortKey?: SortKey;
}

const TRADE_COLUMNS: TradeColumnDef[] = [
  { id: "entryTime", labelKey: "colDate", className: "whitespace-nowrap", sortKey: "entryTime" },
  { id: "symbol", labelKey: "colSymbol" },
  { id: "direction", labelKey: "colDirection" },
  { id: "lots", labelKey: "colLots", className: "text-right" },
  { id: "entry", labelKey: "colEntry", className: "hidden text-right lg:table-cell" },
  { id: "exit", labelKey: "colExit", className: "hidden text-right lg:table-cell", sortKey: "exitTime" },
  { id: "pips", labelKey: "colPips", className: "text-right" },
  { id: "rMultiple", labelKey: "colR", className: "hidden text-right md:table-cell", sortKey: "rMultiple" },
  { id: "netPnl", labelKey: "colPnl", className: "text-right", sortKey: "netPnl" },
  { id: "result", labelKey: "colResult" },
  { id: "status", labelKey: "colStatus" },
  { id: "account", labelKey: "colAccount", className: "hidden lg:table-cell", cellClassName: "text-muted-foreground" },
  { id: "strategy", labelKey: "colStrategy", className: "hidden lg:table-cell", cellClassName: "text-muted-foreground" },
  { id: "session", labelKey: "colSession", className: "hidden xl:table-cell", cellClassName: "text-muted-foreground" },
  { id: "timeframe", labelKey: "colTimeframe", className: "hidden xl:table-cell" },
  { id: "review", labelKey: "colReview", className: "hidden lg:table-cell" },
  // v2.5 M6 — anomaly badge (robust MAD z-score, see #/analytics/anomalies).
  { id: "anomaly", labelKey: "colAnomaly", className: "hidden md:table-cell" },
];

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
  // v2.5 M4 — bulk selection, saved-view rename, column overrides.
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkStrategy, setBulkStrategy] = React.useState("");
  const [bulkAccount, setBulkAccount] = React.useState("");
  const [bulkAddTags, setBulkAddTags] = React.useState<string[]>([]);
  const [bulkRemoveTags, setBulkRemoveTags] = React.useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<SavedViewDTO | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  /** Column layout applied by a saved view (overrides the preference). */
  const [viewColumns, setViewColumns] = React.useState<{
    order: string[];
    visibility: Record<string, boolean>;
  } | null>(null);
  const [viewAutoApplied, setViewAutoApplied] = React.useState(false);

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
  // v2.5 M6 — anomaly flags (all-time, cached 60 s) for the badge column.
  const tAnomalies = useTranslations("analytics.advanced.anomalies");
  const { data: advancedData } = useAdvancedAnalytics({ period: "all" });
  const anomalyByTrade = React.useMemo(() => {
    const map = new Map<
      string,
      { severity: string; kind: string; zScore: number }
    >();
    for (const a of advancedData?.advanced.anomalies.anomalies ?? []) {
      map.set(a.tradeId, {
        severity: a.severity,
        kind: a.kind,
        zScore: a.zScore,
      });
    }
    return map;
  }, [advancedData]);
  const accounts = useAccounts();
  const strategies = useStrategies();
  const tags = useTags();
  const customFields = useCustomFields(false);
  const tableColumns = useTableColumns("trades");
  const saveTableColumns = useSaveTableColumns();
  const savedViews = useSavedViews("trades");
  const createView = useCreateSavedView();
  const updateView = useUpdateSavedView();
  const duplicateView = useDuplicateSavedView();
  const deleteView = useDeleteSavedView();
  const deleteTrade = useDeleteTrade();
  const bulkTrades = useBulkTrades();
  const undoGroup = useUndoGroup();

  const data = trades.data;
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? query.page;

  // ── Columns (v2.5 M4 §4.8): preference, then view override, then default.
  const allColumns = React.useMemo<TradeColumnDef[]>(() => {
    const custom = (customFields.data ?? [])
      .filter((d) => d.showInTable)
      .map((d): TradeColumnDef => ({ id: `cf:${d.key}`, labelKey: `cf:${d.key}` }));
    return [...TRADE_COLUMNS, ...custom];
  }, [customFields.data]);

  const effectiveColumns = React.useMemo(() => {
    const pref = viewColumns ??
      (tableColumns.data
        ? {
            order: tableColumns.data.columnOrder,
            visibility: tableColumns.data.columnVisibility,
          }
        : null);
    if (!pref) {
      return {
        order: allColumns.map((c) => c.id),
        visibility: {} as Record<string, boolean>,
      };
    }
    const known = new Set(allColumns.map((c) => c.id));
    const order = [
      ...pref.order.filter((id) => known.has(id)),
      ...allColumns.map((c) => c.id).filter((id) => !pref.order.includes(id)),
    ];
    return { order, visibility: pref.visibility };
  }, [viewColumns, tableColumns.data, allColumns]);

  const visibleColumns = React.useMemo(
    () =>
      effectiveColumns.order
        .filter((id) => effectiveColumns.visibility[id] !== false)
        .map((id) => allColumns.find((c) => c.id === id))
        .filter((c): c is TradeColumnDef => c !== undefined),
    [effectiveColumns, allColumns]
  );

  const customFieldDefs = React.useMemo(
    () => customFields.data ?? [],
    [customFields.data]
  );

  const columnLabel = (col: TradeColumnDef): string =>
    col.id.startsWith("cf:")
      ? (customFieldDefs.find((d) => `cf:${d.key}` === col.id)?.label ?? col.id)
      : t(col.labelKey);

  // ── Bulk selection (v2.5 M4 §4.4) ──
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTrades = rows.filter((r) => selectedSet.has(r.id));

  // A filter/page change drops the selection (rows may no longer be listed).
  React.useEffect(() => {
    setSelectedIds([]);
  }, [query]);

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

  const clearViewState = () => {
    setActiveViewId(null);
    setViewColumns(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "#/trades");
    }
  };

  const setFilter = (patch: Partial<TradeListQuery>) => {
    clearViewState();
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  };

  const resetFilters = () => {
    clearViewState();
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

  // ── Saved views (v2.5 M4 §4.3): filters + sort + visible columns ──
  const applyView = (view: SavedViewDTO) => {
    setActiveViewId(view.id);
    const filters = view.filters as Partial<TradeListQuery>;
    setSearchInput(typeof filters.search === "string" ? filters.search : "");
    const sortEntry = view.sort?.[0];
    const sortKey =
      sortEntry &&
      (["entryTime", "exitTime", "netPnl", "rMultiple"] as string[]).includes(sortEntry.id)
        ? (sortEntry.id as SortKey)
        : undefined;
    setQuery({
      ...DEFAULT_QUERY,
      ...filters,
      page: 1,
      ...(sortKey
        ? { sort: sortKey, order: sortEntry?.desc ? "desc" : "asc" }
        : {}),
    });
    setViewColumns(
      view.columns
        ? { order: view.columns, visibility: {} }
        : null
    );
    // Shareable URL: #/trades?view=<id> (no navigation, no remount).
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#/trades?view=${view.id}`);
    }
  };

  // Shareable link (?view=) or the default view applies once on mount.
  // Drill-down filters from a chart win over the default view, not over
  // an explicit ?view= link.
  React.useEffect(() => {
    if (viewAutoApplied || savedViews.isLoading) return;
    const views = savedViews.data ?? [];
    if (views.length === 0) {
      setViewAutoApplied(true);
      return;
    }
    const hashViewId = parseHash(window.location.hash).query?.view;
    const target =
      views.find((v) => v.id === hashViewId) ??
      (hashViewId ? undefined : views.find((v) => v.isDefault));
    if (target) {
      applyView(target);
    } else if (!hashViewId && drillFiltersFromHash()) {
      // Drill-down active - leave the filters alone.
    }
    setViewAutoApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedViews.data, savedViews.isLoading, viewAutoApplied]);

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
      {
        page: "trades",
        name,
        filters,
        sort: [{ id: query.sort, desc: query.order === "desc" }],
        columns: visibleColumns.map((c) => c.id),
      },
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
        if (activeViewId === view.id) clearViewState();
        toast({ title: t("viewDeleted") });
      },
      onError: mutationErrorToast,
    });
  };

  const renameView = () => {
    if (!renameTarget || !renameName.trim()) return;
    updateView.mutate(
      { id: renameTarget.id, patch: { name: renameName.trim() } },
      {
        onSuccess: () => {
          toast({ title: t("viewRenamed") });
          setRenameTarget(null);
          setRenameName("");
        },
        onError: mutationErrorToast,
      }
    );
  };

  const togglePinView = (view: SavedViewDTO) => {
    updateView.mutate(
      { id: view.id, patch: { isPinned: !view.isPinned } },
      { onError: mutationErrorToast }
    );
  };

  const toggleDefaultView = (view: SavedViewDTO) => {
    updateView.mutate(
      { id: view.id, patch: { isDefault: !view.isDefault } },
      {
        onSuccess: () =>
          toast({
            title: view.isDefault ? t("viewDefaultRemoved") : t("viewDefaultSet"),
          }),
        onError: mutationErrorToast,
      }
    );
  };

  const duplicateViewFn = (view: SavedViewDTO) => {
    duplicateView.mutate(view, {
      onSuccess: () => toast({ title: t("viewDuplicated") }),
      onError: mutationErrorToast,
    });
  };

  const moveView = (view: SavedViewDTO, dir: -1 | 1) => {
    const views = savedViews.data ?? [];
    const idx = views.findIndex((v) => v.id === view.id);
    const other = views[idx + dir];
    if (!other) return;
    updateView.mutate(
      { id: view.id, patch: { order: other.order } },
      {
        onSuccess: () =>
          updateView.mutate(
            { id: other.id, patch: { order: view.order } },
            { onError: mutationErrorToast }
          ),
        onError: mutationErrorToast,
      }
    );
  };

  // ── Bulk edit (v2.5 M4 §4.4) ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectPage = () => {
    const pageIds = rows.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
    setSelectedIds((prev) =>
      allSelected
        ? prev.filter((id) => !pageIds.includes(id))
        : [...new Set([...prev, ...pageIds])]
    );
  };

  const bulkHasOp =
    bulkStrategy !== "" ||
    bulkAccount !== "" ||
    bulkAddTags.length > 0 ||
    bulkRemoveTags.length > 0;

  const undoToastAction = (groupId: string) => (
    <ToastAction
      altText={t("undo")}
      onClick={() =>
        undoGroup.mutate(groupId, {
          onSuccess: (res) => toast({ title: t("undoneToast", { count: res.restored }) }),
          onError: mutationErrorToast,
        })
      }
    >
      {t("undo")}
    </ToastAction>
  );

  const runBulk = () => {
    bulkTrades.mutate(
      {
        tradeIds: selectedIds,
        strategyId: bulkStrategy || undefined,
        accountId: bulkAccount || undefined,
        addTagIds: bulkAddTags,
        removeTagIds: bulkRemoveTags,
        deleteToTrash: false,
      },
      {
        onSuccess: (res) => {
          setBulkOpen(false);
          setSelectedIds([]);
          setBulkStrategy("");
          setBulkAccount("");
          setBulkAddTags([]);
          setBulkRemoveTags([]);
          toast({
            title: t("bulkDone", { count: res.count }),
            action: undoToastAction(res.groupId),
          });
        },
        onError: mutationErrorToast,
      }
    );
  };

  const runBulkDelete = () => {
    bulkTrades.mutate(
      {
        tradeIds: selectedIds,
        addTagIds: [],
        removeTagIds: [],
        deleteToTrash: true,
      },
      {
        onSuccess: (res) => {
          setBulkDeleteOpen(false);
          setSelectedIds([]);
          toast({
            title: t("bulkDeleted", { count: res.count }),
            action: undoToastAction(res.groupId),
          });
        },
        onError: mutationErrorToast,
      }
    );
  };

  // ── Columns manager (v2.5 M4 §4.8) ──
  const persistColumns = (order: string[], visibility: Record<string, boolean>) => {
    setViewColumns(null);
    saveTableColumns.mutate(
      { tableKey: "trades", columnOrder: order, columnVisibility: visibility },
      { onError: mutationErrorToast }
    );
  };

  const toggleColumn = (id: string) => {
    const visibility = {
      ...effectiveColumns.visibility,
      [id]: effectiveColumns.visibility[id] === false ? true : false,
    };
    persistColumns(effectiveColumns.order, visibility);
  };

  const moveColumn = (id: string, dir: -1 | 1) => {
    const order = [...effectiveColumns.order];
    const idx = order.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= order.length) return;
    [order[idx], order[next]] = [order[next], order[idx]];
    persistColumns(order, effectiveColumns.visibility);
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

  /** One body cell for a visible column (v2.5 M4 §4.8 + custom fields). */
  const tradeCell = (col: TradeColumnDef, trade: TradeListItemDTO) => {
    switch (col.id) {
      case "entryTime":
        return (
          <TableCell key={col.id} className="whitespace-nowrap text-muted-foreground">
            {fmtDateTimeInTz(trade.entryTime, timezone)}
          </TableCell>
        );
      case "symbol":
        return (
          <TableCell key={col.id} className="max-w-[12rem]">
            <div className="flex flex-col gap-1">
              <span className="font-medium tabular-nums">{trade.symbol}</span>
              <TagsBadges tags={trade.tags} />
            </div>
          </TableCell>
        );
      case "direction":
        return (
          <TableCell key={col.id}>
            <DirectionBadge direction={trade.direction} />
          </TableCell>
        );
      case "lots":
        return (
          <TableCell key={col.id} className="text-right tabular-nums">
            <Sensitive kind="lots">{fmtNum(trade.lots)}</Sensitive>
          </TableCell>
        );
      case "entry":
        return (
          <TableCell key={col.id} className="hidden text-right tabular-nums lg:table-cell">
            {fmtPrice(trade.entryPrice, trade.digits)}
          </TableCell>
        );
      case "exit":
        return (
          <TableCell key={col.id} className="hidden text-right tabular-nums lg:table-cell">
            {fmtPrice(trade.exitPrice, trade.digits)}
          </TableCell>
        );
      case "pips":
        return (
          <TableCell
            key={col.id}
            className={`text-right tabular-nums ${pnlClass(trade.pips)}`}
          >
            {fmtSigned(trade.pips)}
          </TableCell>
        );
      case "rMultiple":
        return (
          <TableCell
            key={col.id}
            className={`hidden text-right tabular-nums md:table-cell ${pnlClass(trade.rMultiple)}`}
          >
            {fmtSigned(trade.rMultiple, 2, 2)}
          </TableCell>
        );
      case "netPnl":
        return (
          <TableCell key={col.id} className="text-right font-medium tabular-nums">
            <Money
              signed
              value={trade.netPnl}
              currency={trade.pnlCurrency}
              className={pnlClass(trade.netPnl)}
            />
          </TableCell>
        );
      case "result":
        return (
          <TableCell key={col.id}>
            {trade.resultType ? (
              <ResultBadge result={trade.resultType} />
            ) : (
              "-"
            )}
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={col.id}>
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={trade.status} />
              {trade.isDraft && <DraftBadge />}
            </div>
          </TableCell>
        );
      case "account":
        return (
          <TableCell key={col.id} className="hidden text-muted-foreground lg:table-cell">
            <Sensitive kind="account">{trade.accountName}</Sensitive>
          </TableCell>
        );
      case "strategy":
        return (
          <TableCell key={col.id} className="hidden text-muted-foreground lg:table-cell">
            {trade.strategyName ?? "-"}
          </TableCell>
        );
      case "session":
        return (
          <TableCell key={col.id} className="hidden text-muted-foreground xl:table-cell">
            {labels.session(trade.session)}
          </TableCell>
        );
      case "timeframe":
        return (
          <TableCell key={col.id} className="hidden tabular-nums xl:table-cell">
            {trade.timeframe ?? "-"}
          </TableCell>
        );
      case "review":
        return (
          <TableCell key={col.id} className="hidden lg:table-cell">
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
        );
      case "anomaly": {
        const flag = anomalyByTrade.get(trade.id);
        if (!flag) {
          return (
            <TableCell key={col.id} className="hidden md:table-cell">
              -
            </TableCell>
          );
        }
        const kindLabel =
          flag.kind === "R_OUTLIER"
            ? tAnomalies("kindROutlier")
            : tAnomalies("kindDurationOutlier");
        const sevLabel =
          flag.severity === "high"
            ? tAnomalies("sevHigh")
            : tAnomalies("sevModerate");
        return (
          <TableCell key={col.id} className="hidden md:table-cell">
            <span
              className="inline-flex"
              title={`${kindLabel} - ${sevLabel} (z ${flag.zScore})`}
            >
              <AlertTriangle
                className={
                  flag.severity === "high"
                    ? "h-4 w-4 text-destructive"
                    : "h-4 w-4 text-amber-500"
                }
                aria-hidden="true"
              />
              <span className="sr-only">
                {kindLabel} - {sevLabel}
              </span>
            </span>
          </TableCell>
        );
      }
      default: {
        // Custom-field column ("cf:<key>").
        const def = customFieldDefs.find((d) => `cf:${d.key}` === col.id);
        if (!def) return <TableCell key={col.id}>-</TableCell>;
        return (
          <TableCell key={col.id} className="hidden whitespace-nowrap lg:table-cell">
            {formatCustomFieldValue(def, trade.customFields?.[def.key])}
          </TableCell>
        );
      }
    }
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
            aria-label={t("columns")}
            onClick={() => setColumnsOpen(true)}
          >
            <Columns3 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("columns")}</span>
          </Button>
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
                {/* v2.5 M4 — filter by a SELECT custom field (one at a time). */}
                {customFieldDefs
                  .filter((d) => d.type === "SELECT" && (d.options?.length ?? 0) > 0)
                  .map((def) => (
                    <FilterSelect
                      key={def.key}
                      id={`filter-cf-${def.key}`}
                      label={def.label}
                      value={
                        query.customFieldKey === def.key
                          ? query.customFieldValue
                          : undefined
                      }
                      options={(def.options ?? []).map((o) => ({
                        value: o,
                        label: o,
                      }))}
                      onChange={(v) =>
                        setFilter({
                          customFieldKey: v ? def.key : undefined,
                          customFieldValue: v,
                        })
                      }
                    />
                  ))}
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
                <DateField
                  id="filter-from"
                  label={t("from")}
                  className="h-8 w-32"
                  value={query.dateFrom ?? ""}
                  onChange={(v) =>
                    setFilter({ dateFrom: v || undefined })
                  }
                />
                <DateField
                  id="filter-to"
                  label={t("to")}
                  className="h-8 w-32"
                  value={query.dateTo ?? ""}
                  onChange={(v) =>
                    setFilter({ dateTo: v || undefined })
                  }
                />
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
          {views.map((view, idx) => (
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
                {view.isPinned && (
                  <Pin className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                )}
                {view.isDefault && (
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                )}
                {view.name}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 rounded-none border-0 border-l px-0 text-muted-foreground"
                    aria-label={t("viewMenu", { name: view.name })}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameTarget(view);
                      setRenameName(view.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {t("renameView")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateViewFn(view)}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {t("duplicateView")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => togglePinView(view)}>
                    <Pin className="h-4 w-4" aria-hidden="true" />
                    {view.isPinned ? t("unpinView") : t("pinView")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleDefaultView(view)}>
                    <Star className="h-4 w-4" aria-hidden="true" />
                    {view.isDefault ? t("unsetDefaultView") : t("setDefaultView")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={idx === 0}
                    onClick={() => moveView(view, -1)}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    {t("moveViewUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={idx === views.length - 1}
                    onClick={() => moveView(view, 1)}
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    {t("moveViewDown")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => removeView(view)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t("deleteView")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

      {/* ── Bulk bar (v2.5 M4 §4.4) ── */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <p className="text-sm font-medium">
            {t("selectedCount", { count: selectedIds.length })}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBulkStrategy("");
              setBulkAccount("");
              setBulkAddTags([]);
              setBulkRemoveTags([]);
              setBulkOpen(true);
            }}
          >
            {t("bulkEdit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("bulkDelete")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
            {t("clearSelection")}
          </Button>
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
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      rows.length > 0 && rows.every((r) => selectedSet.has(r.id))
                        ? true
                        : rows.some((r) => selectedSet.has(r.id))
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={() => toggleSelectPage()}
                    aria-label={t("selectPage")}
                  />
                </TableHead>
                {visibleColumns.map((col) => (
                  <TableHead key={col.id} className={col.className}>
                    {col.sortKey ? (
                      <SortButton
                        label={columnLabel(col)}
                        active={query.sort === col.sortKey}
                        order={query.order}
                        ariaLabel={t("sortAria", { column: columnLabel(col) })}
                        onClick={() => onSort(col.sortKey as SortKey)}
                      />
                    ) : (
                      columnLabel(col)
                    )}
                  </TableHead>
                ))}
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedSet.has(trade.id)}
                      onCheckedChange={() => toggleSelect(trade.id)}
                      aria-label={t("selectTrade", { symbol: trade.symbol })}
                    />
                  </TableCell>
                  {visibleColumns.map((col) => tradeCell(col, trade))}
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

      {/* ── Bulk edit dialog (v2.5 M4 §4.4) — preview before applying ── */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bulkTitle", { count: selectedIds.length })}</DialogTitle>
            <DialogDescription>{t("bulkDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-strategy">{t("strategy")}</Label>
              <Select
                value={bulkStrategy || "none"}
                onValueChange={(v) => setBulkStrategy(v === "none" ? "" : v)}
              >
                <SelectTrigger id="bulk-strategy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("bulkUnchanged")}</SelectItem>
                  {(strategies.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-account">{t("account")}</Label>
              <Select
                value={bulkAccount || "none"}
                onValueChange={(v) => setBulkAccount(v === "none" ? "" : v)}
              >
                <SelectTrigger id="bulk-account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("bulkUnchanged")}</SelectItem>
                  {(accounts.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("bulkAddTags")}</Label>
              <div className="flex flex-wrap gap-2">
                {(tags.data ?? []).map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    <Checkbox
                      checked={bulkAddTags.includes(tag.id)}
                      onCheckedChange={(v) =>
                        setBulkAddTags((prev) =>
                          v ? [...prev, tag.id] : prev.filter((x) => x !== tag.id)
                        )
                      }
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("bulkRemoveTags")}</Label>
              <div className="flex flex-wrap gap-2">
                {(tags.data ?? []).map((tag) => (
                  <label
                    key={tag.id}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    <Checkbox
                      checked={bulkRemoveTags.includes(tag.id)}
                      onCheckedChange={(v) =>
                        setBulkRemoveTags((prev) =>
                          v ? [...prev, tag.id] : prev.filter((x) => x !== tag.id)
                        )
                      }
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("bulkPreview")}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {selectedTrades.slice(0, 5).map((tr) => (
                  <li key={tr.id} className="flex justify-between gap-2">
                    <span>
                      {tr.symbol} - {tr.direction}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtDateTimeInTz(tr.entryTime, timezone)}
                    </span>
                  </li>
                ))}
              </ul>
              {selectedTrades.length > 5 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("bulkMore", { count: selectedTrades.length - 5 })}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkTrades.isPending}
              onClick={() => setBulkOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!bulkHasOp || bulkTrades.isPending}
              onClick={runBulk}
            >
              {bulkTrades.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t("bulkApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete confirmation (to the trash, undoable) ── */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("bulkDeleteTitle", { count: selectedIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("bulkDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkTrades.isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkTrades.isPending}
              onClick={(e) => {
                e.preventDefault();
                runBulkDelete();
              }}
            >
              {bulkTrades.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Rename saved view ── */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("renameView")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("viewName")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-view-name">{t("viewName")}</Label>
            <Input
              id="rename-view-name"
              value={renameName}
              maxLength={60}
              onChange={(e) => setRenameName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={updateView.isPending}
              onClick={() => setRenameTarget(null)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={!renameName.trim() || updateView.isPending}
              onClick={renameView}
            >
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Column manager (v2.5 M4 §4.8) ── */}
      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("columnsTitle")}</DialogTitle>
            <DialogDescription>{t("columnsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {effectiveColumns.order.map((id) => {
              const col = allColumns.find((c) => c.id === id);
              if (!col) return null;
              const visible = effectiveColumns.visibility[id] !== false;
              const idx = effectiveColumns.order.indexOf(id);
              return (
                <div
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={visible}
                      onCheckedChange={() => toggleColumn(id)}
                    />
                    {columnLabel(col)}
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={idx === 0}
                      aria-label={t("moveViewUp")}
                      onClick={() => moveColumn(id, -1)}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={idx === effectiveColumns.order.length - 1}
                      aria-label={t("moveViewDown")}
                      onClick={() => moveColumn(id, 1)}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                persistColumns(
                  allColumns.map((c) => c.id),
                  {}
                )
              }
            >
              {t("columnsReset")}
            </Button>
            <Button onClick={() => setColumnsOpen(false)}>
              {tCommon("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
