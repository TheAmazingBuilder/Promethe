"use client";

/**
 * Widget shell — the card wrapper every grid widget renders in: drag handle +
 * title + period chip (popover editor) header, error boundary body, skeleton
 * while loading, per-widget error alert with retry, unknown-type placeholder,
 * gear menu (configure / duplicate / a11y move-resize / remove with confirm).
 */
import * as React from "react";
import {
  AlertTriangle,
  Copy,
  GripVertical,
  MoreVertical,
  Move3d,
  RotateCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodEditor } from "@/components/dashboard/period-editor";
import { WidgetConfigDialog } from "@/components/dashboard/config-dialog";
import type { WidgetDefinition } from "@/lib/dashboard/registry";
import type {
  DashboardWidgetDTO,
  WidgetLayout,
  WidgetLayouts,
} from "@/lib/dashboard/types";
import type { WidgetPatchInput } from "@/lib/validations/dashboard";
import { cn } from "@/lib/utils";

// ── Error boundary ───────────────────────────────────────────────────────────

interface BoundaryState {
  hasError: boolean;
}

/** Isolates render crashes to a single widget ("unavailable" fallback). */
export class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  BoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    console.error("[widget] render failed:", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ── Period chip label ────────────────────────────────────────────────────────

interface PeriodChip {
  key: string;
  days?: number;
  trades?: number;
}

function periodChipOf(widget: DashboardWidgetDTO): PeriodChip {
  const o = widget.periodOverride;
  if (!o || o.mode === "INHERIT") return { key: "inherit" };
  if (o.mode === "PRESET") return { key: o.preset ?? "last30" };
  if (o.mode === "ROLLING_DAYS")
    return { key: "rollingDays", days: o.rollingDays ?? 30 };
  if (o.mode === "ROLLING_TRADES")
    return { key: "rollingTrades", trades: o.rollingTrades ?? 20 };
  return { key: "custom" };
}

/** md/sm derived from lg with the layout.ts column budgets. */
function deriveBreakpoints(lg: WidgetLayout): WidgetLayouts {
  const derive = (budget: number): WidgetLayout => {
    const w = Math.min(lg.w, budget);
    return { x: Math.max(0, Math.min(lg.x, budget - w)), y: lg.y, w, h: lg.h };
  };
  return { lg, md: derive(6), sm: derive(4) };
}

// ── A11y move / resize dialog ────────────────────────────────────────────────

function MoveResizeDialog({
  open,
  onOpenChange,
  widget,
  definition,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget: DashboardWidgetDTO;
  definition: WidgetDefinition;
  onApply: (layouts: WidgetLayouts) => void;
}) {
  const t = useTranslations("dashboards");
  const base = widget.layouts.lg ?? {
    x: 0,
    y: 0,
    w: definition.defaultLayout.w,
    h: definition.defaultLayout.h,
  };
  const minW = definition.minSize.w;
  const minH = definition.minSize.h;
  const maxW = Math.min(definition.maxSize.w, 12);
  const maxH = definition.maxSize.h;

  const [pos, setPos] = React.useState({ x: base.x, y: base.y, w: base.w, h: base.h });

  React.useEffect(() => {
    if (open) setPos({ x: base.x, y: base.y, w: base.w, h: base.h });
  }, [open, base.x, base.y, base.w, base.h]);

  const move = (dx: number, dy: number) =>
    setPos((p) => ({
      ...p,
      x: Math.max(0, Math.min(12 - p.w, p.x + dx)),
      y: Math.max(0, Math.min(200, p.y + dy)),
    }));

  const resize = (dw: number, dh: number) =>
    setPos((p) => ({
      ...p,
      w: Math.max(minW, Math.min(maxW, p.w + dw)),
      h: Math.max(minH, Math.min(maxH, p.h + dh)),
      x: Math.max(0, Math.min(12 - Math.max(minW, Math.min(maxW, p.w + dw)), p.x)),
    }));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        move(-1, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        move(1, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(0, -1);
        break;
      case "ArrowDown":
        event.preventDefault();
        move(0, 1);
        break;
      case "+":
      case "=":
        event.preventDefault();
        resize(1, 0);
        break;
      case "-":
      case "_":
        event.preventDefault();
        resize(-1, 0);
        break;
      default:
        break;
    }
  };

  const live = t("a11y.position", {
    col: pos.x + 1,
    row: pos.y + 1,
    w: pos.w,
    h: pos.h,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Move3d className="h-4 w-4" aria-hidden="true" />
            {t("a11y.moveResizeTitle")}
          </DialogTitle>
          <DialogDescription>{t("a11y.moveResizeDesc")}</DialogDescription>
        </DialogHeader>
        <div
          role="application"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label={live}
          className="space-y-3 rounded-md border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p aria-live="polite" className="text-sm font-medium tabular-nums">
            {live}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("a11y.moveResizeHint")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => resize(-1, 0)}>
              {t("a11y.narrower")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => resize(1, 0)}>
              {t("a11y.wider")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => resize(0, -1)}>
              {t("a11y.shorter")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => resize(0, 1)}>
              {t("a11y.taller")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("edit.cancel")}
          </Button>
          <Button
            onClick={() => {
              onApply(deriveBreakpoints(pos));
              onOpenChange(false);
            }}
          >
            {t("a11y.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export interface WidgetShellProps
  extends React.ComponentPropsWithoutRef<"div"> {
  widget: DashboardWidgetDTO;
  definition: WidgetDefinition | undefined;
  editMode: boolean;
  /** Data entry of this widget from the batched payload. */
  entry:
    | {
        data: unknown | null;
        error: string | null;
        currency?: string;
        excludedTradeCount?: number;
      }
    | undefined;
  loading: boolean;
  onPatch: (patch: WidgetPatchInput) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRetry: () => void;
  children: React.ReactNode;
  /** Position in the grid - drives the staggered entrance delay. */
  index?: number;
}

export function WidgetShell({
  widget,
  definition,
  editMode,
  entry,
  loading,
  onPatch,
  onDuplicate,
  onRemove,
  onRetry,
  children,
  className,
  style,
  index,
  ...rest
}: WidgetShellProps) {
  const t = useTranslations("dashboards");
  const tRoot = useTranslations();
  const [configOpen, setConfigOpen] = React.useState(false);
  const [a11yOpen, setA11yOpen] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const chip = periodChipOf(widget);
  const chipLabel =
    chip.key === "rollingDays"
      ? t("periods.rollingDays", { count: chip.days ?? 30 })
      : chip.key === "rollingTrades"
        ? t("periods.rollingTrades", { count: chip.trades ?? 20 })
        : t(`periods.${chip.key}`);

  const title = widget.title ?? (definition ? tRoot(definition.nameKey) : widget.type);
  const hasError = entry?.error != null;
  const unavailableFallback = (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{t("registry.unavailable")}</AlertTitle>
      <AlertDescription>{t("registry.unavailableDesc")}</AlertDescription>
    </Alert>
  );

  return (
    <div
      className={cn(
        "widget-enter relative flex h-full min-h-0 flex-col rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200 ease-out",
        // Hover lift only outside edit mode - while dragging, the card stays put.
        !editMode &&
          "hover:-translate-y-0.5 hover:border-accent-foreground/25 hover:shadow-md",
        className
      )}
      style={{
        ...style,
        animationDelay: `${Math.min((index ?? 0) * 40, 320)}ms`,
      }}
      {...rest}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
        {editMode ? (
          <span
            className="widget-drag-handle flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
            aria-hidden="true"
            title={t("edit.dragHint")}
          >
            <GripVertical className="h-4 w-4" />
          </span>
        ) : null}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h3>

        {/* Period chip — interactive in every mode */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${chipLabel} - ${t("periods.editAria", { name: title })}`}
            >
              <Badge
                variant="outline"
                className="max-w-36 truncate text-[10px] font-normal"
              >
                {chipLabel}
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <PeriodEditor
              key={JSON.stringify(widget.periodOverride ?? null)}
              override={widget.periodOverride}
              onSave={(periodOverride) => onPatch({ periodOverride })}
            />
          </PopoverContent>
        </Popover>

        {editMode && definition ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t("edit.widgetMenuAria", { name: title })}
              >
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setConfigOpen(true)}>
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                {t("edit.configure")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("edit.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setA11yOpen(true)}>
                <Move3d className="h-4 w-4" aria-hidden="true" />
                {t("edit.a11yItem")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("edit.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Body (container-query root for widget-internal responsive grids).
          a11y (M8 Phase 5): tabIndex makes the scrollable region keyboard-
          reachable when content overflows (200 % text scale, small widgets). */}
      <div
        tabIndex={0}
        className="@container relative min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-none"
      >
        {entry?.excludedTradeCount != null && entry.excludedTradeCount > 0 ? (
          <p className="mb-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {t("currencyScopeNote", {
              count: entry.excludedTradeCount,
              currency: entry.currency ?? "—",
            })}
          </p>
        ) : null}
        {definition == null ? (
          unavailableFallback
        ) : hasError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>{t("registry.unavailable")}</AlertTitle>
            <AlertDescription>
              {t(
                entry?.error === "METRIC_NOT_FOUND"
                  ? "errors.METRIC_NOT_FOUND"
                  : "errors.WIDGET_DATA_FAILED"
              )}
            </AlertDescription>
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                {t("registry.retry")}
              </Button>
            </div>
          </Alert>
        ) : loading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">{t("registry.loading")}</span>
            <Skeleton className="h-5 w-2/3 rounded" />
            <Skeleton className="h-16 w-full rounded" />
            <Skeleton className="h-16 w-full rounded" />
          </div>
        ) : (
          <WidgetErrorBoundary fallback={unavailableFallback}>
            {children}
          </WidgetErrorBoundary>
        )}
      </div>

      {/* Dialogs (edit mode) */}
      {definition ? (
        <>
          <WidgetConfigDialog
            key={`config-${configOpen ? widget.id + String(widget.config) : "closed"}`}
            widget={widget}
            open={configOpen}
            onOpenChange={setConfigOpen}
            onSave={(config) => onPatch({ config })}
          />
          <MoveResizeDialog
            open={a11yOpen}
            onOpenChange={setA11yOpen}
            widget={widget}
            definition={definition}
            onApply={(layouts) => onPatch({ layouts })}
          />
        </>
      ) : null}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("edit.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("edit.removeDesc", { name: title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("edit.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onRemove}
            >
              {t("edit.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
