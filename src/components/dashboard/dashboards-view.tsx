"use client";

/**
 * DashboardsView (v2.5 Module 1) — replaces the old fixed dashboard.
 *
 * Header: greeting + global filters (period preset / account, URL state
 * `#/?p=&a=&d=`). Dashboard tabs (dnd-kit reorder, rename / default / delete,
 * create from blank or the 6 built-in templates). Edit mode toolbar
 * (customize, add widget, undo, reset layout, done) with live announcements.
 * Desktop/tablet: react-grid-layout (12 cols, drag + resize in edit mode,
 * 600 ms debounced autosave, optimistic cache). Mobile: single-column stack
 * ordered by the lg layout with up/down reorder buttons in edit mode.
 */
import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  LayoutTemplate,
  MoreHorizontal,
  PencilRuler,
  Plus,
  RotateCcw,
  Star,
  Undo2,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import type {
  LayoutItem,
  ResponsiveLayouts,
} from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import {
  useAddWidget,
  useAppearance,
  useCreateDashboard,
  useDashboardData,
  useDashboards,
  useDeleteDashboard,
  useDeleteWidget,
  usePatchDashboard,
  usePatchWidget,
  useReorderDashboards,
} from "@/hooks/use-dashboards";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSession } from "@/components/app/session-context";
import { useI18n } from "@/i18n/i18n-provider";
import { intlLocale } from "@/i18n/config";
import { navigate } from "@/lib/router";
import { getWidgetDefinition } from "@/lib/dashboard/registry";
import {
  GRID_BREAKPOINTS,
  GRID_COLS,
  MAX_DASHBOARDS,
  PERIOD_PRESETS,
  isPeriodPreset,
  type DashboardDTO,
  type DashboardWidgetDTO,
  type PeriodPreset,
  type WidgetLayouts,
} from "@/lib/dashboard/types";
import { findFreeSlot } from "@/lib/dashboard/layout";
import { DENSITY_GRID, isDensityKey } from "@/lib/dashboard/appearance";
import { BUILT_IN_TEMPLATES } from "@/lib/dashboard/templates";
// Registers the v2.5 M2 chart widgets before any getWidgetDefinition /
// safeParseWidgetConfig call — idempotent side-effect import.
import "@/lib/dashboard/register-chart-widgets";
import type { WidgetPatchInput } from "@/lib/validations/dashboard";
import { WidgetShell } from "@/components/dashboard/widget-shell";
import { WidgetCatalog } from "@/components/dashboard/widget-catalog";
import { WidgetRenderer } from "@/components/dashboard/widgets";
import { asKpiData } from "@/components/dashboard/widgets/types";
import { DashboardIcon } from "@/components/dashboard/icons";
import { cn } from "@/lib/utils";

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAST_DASHBOARD_KEY = "tj_last_dashboard";
const SAVE_DEBOUNCE_MS = 600;

// ── Layout helpers ───────────────────────────────────────────────────────────

/** All widget layouts keyed by widget id (the undo snapshot shape). */
type LayoutMap = Record<string, WidgetLayouts>;

function snapshotLayouts(widgets: DashboardWidgetDTO[]): LayoutMap {
  const out: LayoutMap = {};
  for (const w of widgets) out[w.id] = w.layouts;
  return out;
}

function layoutsEqual(a?: WidgetLayouts, b?: WidgetLayouts): boolean {
  for (const bp of ["lg", "md", "sm"] as const) {
    const x = a?.[bp];
    const y = b?.[bp];
    if (x == null && y == null) continue;
    if (x == null || y == null) return false;
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}

function pickItem(l: LayoutItem): LayoutItem {
  return {
    i: l.i,
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    minW: l.minW,
    maxW: l.maxW,
    minH: l.minH,
    maxH: l.maxH,
  };
}

/** Builds the react-grid-layout layouts (lg/md/sm) from the widget DTOs. */
function buildRglLayouts(
  widgets: DashboardWidgetDTO[]
): ResponsiveLayouts<string> {
  const make = (bp: "lg" | "md" | "sm"): LayoutItem[] =>
    widgets.map((w) => {
      const def = getWidgetDefinition(w.type);
      const l =
        w.layouts[bp] ??
        w.layouts.lg ?? { x: 0, y: 0, w: def?.defaultLayout.w ?? 4, h: def?.defaultLayout.h ?? 3 };
      const cw = Math.max(1, Math.min(l.w, GRID_COLS));
      return {
        i: w.id,
        x: Math.max(0, Math.min(l.x, GRID_COLS - cw)),
        y: Math.max(0, l.y),
        w: cw,
        h: Math.max(1, l.h),
        minW: def?.minSize.w,
        maxW: def?.maxSize.w,
        minH: def?.minSize.h,
        maxH: def?.maxSize.h,
      };
    });
  return { lg: make("lg"), md: make("md"), sm: make("sm") };
}

/** Chart body height derived from the grid row height (40px) minus the header. */
function chartHeightPx(widget: DashboardWidgetDTO): number {
  const h = widget.layouts.lg?.h ?? 4;
  return Math.max(120, h * 40 - 110);
}

/** URL query of the dashboard route (`#/?p=&a=&d=`). */
function readHashQuery(): URLSearchParams {
  const qs = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(qs);
}

// ── Sortable dashboard tab ───────────────────────────────────────────────────

function SortableDashboardTab({
  dashboard,
  isActive,
  onSelect,
  onMenuAction,
}: {
  dashboard: DashboardDTO;
  isActive: boolean;
  onSelect: () => void;
  onMenuAction: (action: "rename" | "default" | "delete") => void;
}) {
  const t = useTranslations("dashboards");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dashboard.id });

  return (
    <div
      ref={setNodeRef}
      // a11y (M8 Phase 5): presentational wrapper — the tablist "sees through"
      // it to the role="tab" button (aria-required-children).
      role="presentation"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex shrink-0 items-center rounded-lg border bg-background",
        isActive ? "border-primary/50" : "border-transparent",
        isDragging && "z-10 opacity-80 shadow-md"
      )}
      data-dashboard-id={dashboard.id}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-current={isActive ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
        title={dashboard.name}
      >
        <DashboardIcon iconKey={dashboard.icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-32 truncate">{dashboard.name}</span>
        {dashboard.isDefault ? (
          <Star
            className="h-3 w-3 shrink-0 fill-current text-amber-500"
            aria-hidden="true"
          />
        ) : null}
      </button>
      {isActive ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-7 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("tabs.tabMenuAria", { name: dashboard.name })}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onMenuAction("rename")}>
              <PencilRuler className="h-4 w-4" aria-hidden="true" />
              {t("edit.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onMenuAction("default")}
              disabled={dashboard.isDefault}
            >
              <Star className="h-4 w-4" aria-hidden="true" />
              {t("edit.setDefault")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onMenuAction("delete")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("edit.deleteDashboard")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function DashboardsView() {
  const { session } = useSession();
  const { locale } = useI18n();
  const t = useTranslations("dashboards");
  const tDash = useTranslations("dashboard");
  const tAnalytics = useTranslations("analytics");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // ── URL state (p = preset, a = account, d = dashboard) ──
  const [preset, setPreset] = React.useState<PeriodPreset>("last30");
  const [accountFilter, setAccountFilter] = React.useState<string>("all");
  const [urlDashboardId, setUrlDashboardId] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [storedId, setStoredId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const read = () => {
      const params = readHashQuery();
      const p = params.get("p");
      if (p && isPeriodPreset(p)) setPreset(p);
      const a = params.get("a");
      setAccountFilter(a ?? "all");
      setUrlDashboardId(params.get("d"));
    };
    read();
    setHydrated(true);
    setStoredId(window.localStorage.getItem(LAST_DASHBOARD_KEY));
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // ── Data ──
  const {
    data: dashboardsData,
    isLoading: dashboardsLoading,
    isError: dashboardsError,
    refetch: refetchDashboards,
  } = useDashboards();
  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];
  const dashboards = dashboardsData?.dashboards ?? [];
  const requirements = dashboardsData?.requirements ?? null;

  const active = React.useMemo<DashboardDTO | null>(() => {
    if (dashboards.length === 0) return null;
    const wanted = urlDashboardId ?? storedId;
    return (
      dashboards.find((d) => d.id === wanted) ??
      dashboards.find((d) => d.isDefault) ??
      dashboards[0]!
    );
  }, [dashboards, urlDashboardId, storedId]);

  const effectiveAccountId =
    accountFilter !== "all" && accounts.some((a) => a.id === accountFilter)
      ? accountFilter
      : null;

  const {
    data: dashboardData,
    isPending: dataPending,
    isError: dataError,
    refetch: refetchData,
  } = useDashboardData(active?.id ?? null, preset, effectiveAccountId);

  // ── Density (v2.5 M1 appearance) — react-grid-layout row height + gap ──
  const { data: appearanceData } = useAppearance();
  const densityKey = appearanceData?.density ?? "COMFORTABLE";
  const density =
    DENSITY_GRID[isDensityKey(densityKey) ? densityKey : "COMFORTABLE"];

  // Keep the URL query + last-opened dashboard in sync without navigating.
  React.useEffect(() => {
    if (!hydrated) return;
    const sp = new URLSearchParams();
    sp.set("p", preset);
    if (effectiveAccountId) sp.set("a", effectiveAccountId);
    if (active?.id) sp.set("d", active.id);
    const next = `#/?${sp.toString()}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [hydrated, preset, effectiveAccountId, active?.id]);

  React.useEffect(() => {
    if (active?.id) {
      window.localStorage.setItem(LAST_DASHBOARD_KEY, active.id);
    }
  }, [active?.id]);

  // ── Edit mode, announcements ──
  const [editMode, setEditMode] = React.useState(false);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const announce = React.useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const enterEdit = () => {
    setEditMode(true);
    announce(t("edit.editModeOn"));
  };
  const exitEdit = () => {
    setEditMode(false);
    announce(t("edit.editModeOff"));
  };

  // Command palette hook: "Customize dashboard".
  React.useEffect(() => {
    const onCustomize = () => {
      setEditMode(true);
      setAnnouncement(t("edit.editModeOn"));
    };
    window.addEventListener("tj:customize-dashboard", onCustomize);
    return () =>
      window.removeEventListener("tj:customize-dashboard", onCustomize);
  }, [t]);

  // ── Mutations ──
  const createDashboard = useCreateDashboard();
  const patchDashboard = usePatchDashboard();
  const deleteDashboard = useDeleteDashboard();
  const reorderDashboards = useReorderDashboards();
  const addWidget = useAddWidget();
  const deleteWidget = useDeleteWidget();
  const patchWidgetNormal = usePatchWidget();
  const patchWidgetOptimistic = usePatchWidget({ optimistic: true });

  // ── Grid layouts state (desktop/tablet) ──
  const [gridState, setGridState] = React.useState<ResponsiveLayouts<string> | null>(null);
  const gridsRef = React.useRef<ResponsiveLayouts<string> | null>(null);
  const savedLayoutsRef = React.useRef<LayoutMap>({});
  const undoSnapshotRef = React.useRef<LayoutMap | null>(null);
  const [canUndo, setCanUndo] = React.useState(false);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const editModeRef = React.useRef(editMode);

  React.useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const layoutsSignature = React.useMemo(
    () =>
      active?.widgets.map((w) => `${w.id}:${JSON.stringify(w.layouts)}`).join("|") ??
      "",
    [active]
  );

  // Rebuild the grid from the server whenever the widget set / layouts change
  // (add, remove, config refresh, optimistic autosave landing in the cache).
  React.useEffect(() => {
    savedLayoutsRef.current = snapshotLayouts(active?.widgets ?? []);
    setGridState(null);
  }, [layoutsSignature, active]);

  const layouts = React.useMemo<ResponsiveLayouts<string>>(
    () => gridState ?? buildRglLayouts(active?.widgets ?? []),
    [gridState, active, layoutsSignature]
  );

  /** Debounced layout save - patches only the widgets that actually moved. */
  const saveLayouts = React.useCallback(() => {
    if (!active) return;
    const all = gridsRef.current;
    if (!all) return;
    let saved = 0;
    for (const w of active.widgets) {
      const lg = all.lg?.find((l) => l.i === w.id);
      if (!lg) continue;
      const next: WidgetLayouts = {
        lg: { x: lg.x, y: lg.y, w: lg.w, h: lg.h },
      };
      const md = all.md?.find((l) => l.i === w.id);
      if (md) next.md = { x: md.x, y: md.y, w: md.w, h: md.h };
      const sm = all.sm?.find((l) => l.i === w.id);
      if (sm) next.sm = { x: sm.x, y: sm.y, w: sm.w, h: sm.h };
      if (layoutsEqual(savedLayoutsRef.current[w.id], next)) continue;
      savedLayoutsRef.current[w.id] = next;
      saved += 1;
      patchWidgetOptimistic.mutate({
        dashboardId: active.id,
        widgetId: w.id,
        patch: { layouts: next },
      });
    }
    if (saved > 0) {
      setAnnouncement(t("edit.layoutSaved"));
    }
  }, [active, patchWidgetOptimistic, t]);

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveLayouts();
    }, SAVE_DEBOUNCE_MS);
  }, [saveLayouts]);

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const snapshotForUndo = React.useCallback(() => {
    undoSnapshotRef.current = { ...savedLayoutsRef.current };
    setCanUndo(true);
  }, []);

  const onGridLayoutChange = (
    _layout: readonly LayoutItem[],
    allLayouts: ResponsiveLayouts<string>
  ) => {
    const normalized: ResponsiveLayouts<string> = {
      lg: (allLayouts.lg ?? []).map(pickItem),
      md: (allLayouts.md ?? []).map(pickItem),
      sm: (allLayouts.sm ?? []).map(pickItem),
    };
    gridsRef.current = normalized;
    setGridState((prev) =>
      prev && JSON.stringify(prev) === JSON.stringify(normalized)
        ? prev
        : normalized
    );
    if (editModeRef.current) scheduleSave();
  };

  const onGridInteractionStart = React.useCallback(() => {
    snapshotForUndo();
  }, [snapshotForUndo]);

  const undoLayouts = () => {
    const snap = undoSnapshotRef.current;
    if (!snap || !active) return;
    for (const w of active.widgets) {
      const restored = snap[w.id];
      if (!restored) continue;
      if (layoutsEqual(savedLayoutsRef.current[w.id], restored)) continue;
      savedLayoutsRef.current[w.id] = restored;
      patchWidgetOptimistic.mutate({
        dashboardId: active.id,
        widgetId: w.id,
        patch: { layouts: restored },
      });
    }
    undoSnapshotRef.current = null;
    setCanUndo(false);
    setAnnouncement(t("edit.undoDone"));
  };

  /** Restores every widget to its registry default footprint. */
  const resetLayout = () => {
    if (!active || active.widgets.length === 0) return;
    snapshotForUndo();
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const w of active.widgets) {
      const def = getWidgetDefinition(w.type);
      const dw = def?.defaultLayout.w ?? 4;
      const dh = def?.defaultLayout.h ?? 3;
      const slot = findFreeSlot(placed, dw, dh);
      placed.push({ x: slot.x, y: slot.y, w: dw, h: dh });
      const layoutsReset: WidgetLayouts = {
        lg: { x: slot.x, y: slot.y, w: dw, h: dh },
      };
      savedLayoutsRef.current[w.id] = layoutsReset;
      patchWidgetOptimistic.mutate({
        dashboardId: active.id,
        widgetId: w.id,
        patch: { layouts: layoutsReset },
      });
    }
    setAnnouncement(t("edit.layoutReset"));
  };

  // ── Mobile stack (ordered by the lg layout y then x) ──
  const mobileWidgets = React.useMemo(() => {
    if (!active) return [];
    return [...active.widgets].sort((a, b) => {
      const la = a.layouts.lg ?? a.layouts.md ?? a.layouts.sm;
      const lb = b.layouts.lg ?? b.layouts.md ?? b.layouts.sm;
      if (!la || !lb) return 0;
      return la.y - lb.y || la.x - lb.x;
    });
  }, [active]);

  /** Swaps the y positions of two adjacent widgets in the lg layout. */
  const moveMobileWidget = (widgetId: string, dir: -1 | 1) => {
    if (!active) return;
    const order = mobileWidgets;
    const idx = order.findIndex((w) => w.id === widgetId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const a = order[idx]!;
    const b = order[target]!;
    const base = { x: 0, y: 0, w: 4, h: 3 };
    const ya = a.layouts.lg?.y ?? 0;
    const yb = b.layouts.lg?.y ?? 0;
    if (ya === yb) return;
    snapshotForUndo();
    const patch = (w: DashboardWidgetDTO, y: number) => {
      const lg = { ...(w.layouts.lg ?? base), y };
      const next: WidgetLayouts = { lg };
      savedLayoutsRef.current[w.id] = next;
      patchWidgetOptimistic.mutate({
        dashboardId: active.id,
        widgetId: w.id,
        patch: { layouts: next },
      });
    };
    patch(a, yb);
    patch(b, ya);
  };

  // ── Tab dialogs state ──
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<DashboardDTO | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<DashboardDTO | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onTabDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id || dashboards.length < 2) return;
    const oldIndex = dashboards.findIndex((d) => d.id === dragged.id);
    const newIndex = dashboards.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(dashboards, oldIndex, newIndex);
    reorderDashboards.mutate(next.map((d) => d.id));
  };

  const createBlank = () => {
    const name = createName.trim();
    if (!name) return;
    createDashboard.mutate(
      { name, icon: "layout-dashboard" },
      {
        onSuccess: (dashboard) => {
          setCreateOpen(false);
          setCreateName("");
          setUrlDashboardId(dashboard.id);
          setAnnouncement(t("edit.dashboardCreated", { name: dashboard.name }));
        },
        onError: (error) => {
          toast({
            title: t("edit.createError"),
            description: (error as Error | undefined)?.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const createFromTemplate = (templateKey: string, name: string, icon: string) => {
    if (dashboards.length >= MAX_DASHBOARDS) return;
    createDashboard.mutate(
      { name, icon, templateKey },
      {
        onSuccess: (dashboard) => {
          setUrlDashboardId(dashboard.id);
          setAnnouncement(t("edit.dashboardCreated", { name: dashboard.name }));
        },
        onError: (error) => {
          toast({
            title: t("edit.createError"),
            description: (error as Error | undefined)?.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  // ── Greeting ──
  const timezone = session?.profile.timezone ?? "UTC";
  const currency =
    dashboardData?.currency ?? session?.profile.baseCurrency ?? "USD";

  const today = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat(intlLocale(locale), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: timezone,
      }).format(new Date());
    } catch {
      return "";
    }
  }, [timezone, locale]);

  // ── No-trades onboarding state ──
  const hasNoTrades = React.useMemo(() => {
    if (!active || !dashboardData) return false;
    const kpiWidget = active.widgets.find(
      (w) => w.type === "kpi-strip" || w.type === "single-kpi"
    );
    const openWidget = active.widgets.find((w) => w.type === "open-trades");
    const kpiEntry = kpiWidget
      ? dashboardData.widgets[kpiWidget.id]
      : undefined;
    const openEntry = openWidget
      ? dashboardData.widgets[openWidget.id]
      : undefined;
    const kpiEmpty =
      !kpiWidget || (asKpiData(kpiEntry?.data)?.stats.tradeCount ?? 0) === 0;
    const openPositions = (openEntry?.data as { openPositions?: unknown[] } | null)
      ?.openPositions;
    const openEmpty =
      !openWidget || !Array.isArray(openPositions) || openPositions.length === 0;
    return kpiEmpty && openEmpty;
  }, [active, dashboardData]);

  // ── Widget rendering ──
  const patchWidgetFor =
    (dashboardId: string) =>
    (widgetId: string, patch: WidgetPatchInput) =>
      patchWidgetNormal.mutate({ dashboardId, widgetId, patch });

  const renderShell = (w: DashboardWidgetDTO, index = 0) => {
    if (!active) return null;
    const definition = getWidgetDefinition(w.type);
    const entry = dashboardData?.widgets[w.id];
    const loading =
      !!definition?.hasLoader && dataPending && !dataError;
    const patch = patchWidgetFor(active.id);
    return (
      <WidgetShell
        key={w.id}
        index={index}
        widget={w}
        definition={definition}
        editMode={editMode}
        entry={entry}
        loading={loading}
        onPatch={(patchBody) => patch(w.id, patchBody)}
        onDuplicate={() =>
          addWidget.mutate(
            {
              dashboardId: active.id,
              input: {
                type: w.type,
                title: w.title,
                config: w.config,
                periodOverride: w.periodOverride,
              },
            },
            {
              onSuccess: () =>
                setAnnouncement(t("edit.widgetAdded")),
              onError: (error) =>
                toast({
                  title: t("catalog.addError"),
                  description: (error as Error | undefined)?.message,
                  variant: "destructive",
                }),
            }
          )
        }
        onRemove={() =>
          deleteWidget.mutate(
            { dashboardId: active.id, widgetId: w.id },
            {
              onSuccess: () => setAnnouncement(t("edit.widgetRemoved")),
              onError: (error) =>
                toast({
                  title: t("edit.removeError"),
                  description: (error as Error | undefined)?.message,
                  variant: "destructive",
                }),
            }
          )
        }
        onRetry={() => void refetchData()}
      >
        <WidgetRenderer
          type={w.type}
          data={entry?.data ?? null}
          config={w.config}
          currency={currency}
          timezone={timezone}
          heightPx={chartHeightPx(w)}
        />
      </WidgetShell>
    );
  };

  if (!session) return null;
  const { profile } = session;

  // ── Body sections ──
  const skeletonGrid = (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">{tDash("loadingKpis")}</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );

  const errorCard = (onRetry: () => void) => (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium">{tDash("errorTitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {tDash("errorRetry")}
        </Button>
      </CardContent>
    </Card>
  );

  const onboardingCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{tDash("emptyTitle")}</CardTitle>
        <CardDescription>{tDash("emptyDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={() => navigate("#/trades/quick")} data-tour="quick-trade-alt">
          <Zap className="h-4 w-4" aria-hidden="true" />
          {tDash("emptyCtaQuick")}
        </Button>
        <Button variant="outline" onClick={() => navigate("#/trades/new")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {tDash("emptyCtaForm")}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate("#/reglages/templates")}
        >
          <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
          {tDash("emptyCtaTemplates")}
        </Button>
      </CardContent>
    </Card>
  );

  const body = (() => {
    if (dashboardsLoading) return skeletonGrid;
    if (dashboardsError) return errorCard(() => void refetchDashboards());
    if (!active) return null;
    if (active.widgets.length === 0) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("emptyWidgetsTitle")}</CardTitle>
            <CardDescription>{t("emptyWidgetsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setEditMode(true);
                setCatalogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("edit.addWidget")}
            </Button>
          </CardContent>
        </Card>
      );
    }
    if (dataError) return errorCard(() => void refetchData());
    if (dataPending) return skeletonGrid;

    const grid = isMobile ? (
      <div className="space-y-4">
        {mobileWidgets.map((w, index) => {
          const def = getWidgetDefinition(w.type);
          const name = w.title ?? (def ? tRoot(def.nameKey) : w.type);
          return (
            <div key={w.id} className="space-y-1.5">
              {editMode ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    disabled={index === 0}
                    onClick={() => moveMobileWidget(w.id, -1)}
                    aria-label={t("edit.moveUpAria", { name })}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    disabled={index === mobileWidgets.length - 1}
                    onClick={() => moveMobileWidget(w.id, 1)}
                    aria-label={t("edit.moveDownAria", { name })}
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className="truncate text-xs text-muted-foreground">
                    {name}
                  </span>
                </div>
              ) : null}
              {renderShell(w, index)}
            </div>
          );
        })}
      </div>
    ) : (
      <ResponsiveGridLayout
        layouts={layouts}
        breakpoints={GRID_BREAKPOINTS}
        cols={{ lg: GRID_COLS, md: GRID_COLS, sm: GRID_COLS }}
        rowHeight={density.rowHeight}
        margin={[density.gap, density.gap]}
        compactType="vertical"
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".widget-drag-handle"
        resizeHandles={["se"]}
        onLayoutChange={onGridLayoutChange}
        onDragStart={onGridInteractionStart}
        onResizeStart={onGridInteractionStart}
        className="min-h-40"
      >
        {active.widgets.map((w, i) => renderShell(w, i))}
      </ResponsiveGridLayout>
    );

    return (
      <div className="space-y-6">
        {hasNoTrades ? onboardingCard : null}
        {grid}
      </div>
    );
  })();

  return (
    <div className="space-y-6">
      {/* ── Greeting + global filters ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            {tDash("greeting", { name: profile.displayName })}
          </h2>
          {today && (
            <p className="text-sm capitalize text-muted-foreground">{today}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset}
            onValueChange={(v) => setPreset(v as PeriodPreset)}
          >
            <SelectTrigger
              size="sm"
              className="w-[150px]"
              aria-label={t("filters.period")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`periods.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger
              size="sm"
              className="w-[180px]"
              aria-label={t("filters.account")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {tAnalytics("allAccounts")}
              </SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Dashboard tabs ── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onTabDragEnd}
      >
        <SortableContext
          items={dashboards.map((d) => d.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="-mx-1 flex items-center gap-1.5 px-1 pb-1">
            {/* a11y (M8 Phase 5): plain nav + aria-current — the dashboard
                tabs are click-only (no arrow-key tab semantics), so
                role="tablist" would over-claim and trip aria-required-children. */}
            <nav
              aria-label={t("tabs.listAria")}
              className="flex items-center gap-1.5 overflow-x-auto"
            >
              {dashboards.map((d) => (
                <SortableDashboardTab
                  key={d.id}
                  dashboard={d}
                  isActive={active?.id === d.id}
                  onSelect={() => setUrlDashboardId(d.id)}
                  onMenuAction={(action) => {
                    if (action === "rename") {
                      setRenameName(d.name);
                      setRenameTarget(d);
                    } else if (action === "default") {
                      patchDashboard.mutate(
                        { id: d.id, patch: { isDefault: true } },
                        {
                          onSuccess: () =>
                            setAnnouncement(
                              t("edit.defaultSet", { name: d.name })
                            ),
                        }
                      );
                    } else {
                      setDeleteTarget(d);
                    }
                  }}
                />
              ))}
            </nav>
            {/* a11y (M8 Phase 5): kept OUTSIDE the nav — only the tab buttons
                belong to the dashboard switcher. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label={t("edit.newDashboard")}
                  disabled={dashboards.length >= MAX_DASHBOARDS}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>{t("edit.newDashboard")}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setCreateName("");
                    setCreateOpen(true);
                  }}
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <span className="flex flex-col">
                    <span>{t("templates.blank")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("templates.blankDesc")}
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {BUILT_IN_TEMPLATES.map((tpl) => {
                  const td = tpl.dashboards[0];
                  if (!td) return null;
                  return (
                    <DropdownMenuItem
                      key={tpl.key}
                      onClick={() =>
                        createFromTemplate(
                          tpl.key,
                          tRoot(td.nameKey),
                          td.icon
                        )
                      }
                    >
                      <DashboardIcon iconKey={td.icon} className="h-4 w-4" />
                      <span className="flex flex-col">
                        <span>{tRoot(tpl.nameKey)}</span>
                        <span className="text-xs text-muted-foreground">
                          {tRoot(tpl.descriptionKey)}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SortableContext>
      </DndContext>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!editMode ? (
          <Button variant="outline" size="sm" onClick={enterEdit}>
            <PencilRuler className="h-4 w-4" aria-hidden="true" />
            {t("edit.customize")}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatalogOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("edit.addWidget")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={undoLayouts}
              disabled={!canUndo}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              {t("edit.undo")}
            </Button>
            <Button variant="outline" size="sm" onClick={resetLayout}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("edit.resetLayout")}
            </Button>
            <Button size="sm" onClick={exitEdit}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {t("edit.done")}
            </Button>
          </>
        )}
      </div>

      {/* ── Live announcements ── */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {/* ── Body ── */}
      {body}

      {/* ── Catalog sheet ── */}
      <WidgetCatalog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        dashboard={active}
        requirements={requirements}
        onAdded={(name) => setAnnouncement(t("edit.widgetAddedWithName", { name }))}
      />

      {/* ── Create dashboard dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("edit.newDashboard")}</DialogTitle>
            <DialogDescription>{t("templates.blankDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="new-dashboard-name" className="text-sm font-medium">
              {t("edit.nameLabel")}
            </label>
            <Input
              id="new-dashboard-name"
              value={createName}
              maxLength={40}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createBlank();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("edit.cancel")}
            </Button>
            <Button
              onClick={createBlank}
              disabled={!createName.trim() || createDashboard.isPending}
            >
              {t("edit.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename dialog ── */}
      <Dialog
        open={renameTarget != null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("edit.renameTitle")}</DialogTitle>
            <DialogDescription>
              {t("edit.renameDesc", { name: renameTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="rename-dashboard-name" className="text-sm font-medium">
              {t("edit.nameLabel")}
            </label>
            <Input
              id="rename-dashboard-name"
              value={renameName}
              maxLength={40}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("edit.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!renameTarget) return;
                const name = renameName.trim();
                if (!name) return;
                patchDashboard.mutate(
                  { id: renameTarget.id, patch: { name } },
                  {
                    onSuccess: () => {
                      setRenameTarget(null);
                      setAnnouncement(t("edit.renamed", { name }));
                    },
                  }
                );
              }}
              disabled={!renameName.trim() || patchDashboard.isPending}
            >
              {t("edit.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dashboard confirm ── */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("edit.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("edit.deleteDesc", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("edit.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                const target = deleteTarget;
                deleteDashboard.mutate(target.id, {
                  onSuccess: () => {
                    if (urlDashboardId === target.id) setUrlDashboardId(null);
                    if (storedId === target.id) setStoredId(null);
                    setDeleteTarget(null);
                    setAnnouncement(
                      t("edit.dashboardDeleted", { name: target.name })
                    );
                  },
                  onError: (error) =>
                    toast({
                      title: t("edit.deleteError"),
                      description: (error as Error | undefined)?.message,
                      variant: "destructive",
                    }),
                });
              }}
            >
              {t("edit.deleteDashboard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
