"use client";

/**
 * Trash view (v2.5 Module 4 §4.6) — soft-deleted items with a 30-day
 * retention: list by entity, search, single/bulk restore, permanent
 * delete, empty trash, days-remaining badge.
 *
 * Data: GET /api/trash · POST /api/trash (restore | delete | empty).
 */
import * as React from "react";
import {
  ArrowUpFromLine,
  CalendarDays,
  CandlestickChart,
  NotebookPen,
  Search,
  Tags,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import type { TrashEntity } from "@/lib/trash/constants";

interface TrashItem {
  id: string;
  entity: TrashEntity;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  daysRemaining: number;
}

interface TrashCounts {
  TRADE: number;
  JOURNAL_ENTRY: number;
  STRATEGY: number;
  TAG: number;
  total: number;
}

interface TrashListResponse {
  items: TrashItem[];
  counts: TrashCounts;
}

type EntityFilter = "ALL" | TrashEntity;

const ENTITY_ICONS: Record<TrashEntity, React.ComponentType<{ className?: string }>> = {
  TRADE: CandlestickChart,
  JOURNAL_ENTRY: NotebookPen,
  STRATEGY: Target,
  TAG: Tags,
};

const ENTITY_ORDER: TrashEntity[] = ["TRADE", "JOURNAL_ENTRY", "STRATEGY", "TAG"];

export function TrashView() {
  const t = useTranslations("trashView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [entity, setEntity] = React.useState<EntityFilter>("ALL");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<TrashItem | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Debounced search (cancelable, never floods the API).
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const { data, isLoading, isError } = useQuery<TrashListResponse>({
    queryKey: ["trash", entity, debounced],
    queryFn: () =>
      apiFetch<TrashListResponse>(
        `/api/trash?entity=${entity === "ALL" ? "" : entity}${debounced ? `&search=${encodeURIComponent(debounced)}` : ""}`
      ),
  });

  const items = data?.items ?? [];
  const counts = data?.counts ?? { TRADE: 0, JOURNAL_ENTRY: 0, STRATEGY: 0, TAG: 0, total: 0 };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["trash"] });
    // Restored trades reappear in every list — refresh the app's caches.
    void queryClient.invalidateQueries();
  };

  const act = async (body: Record<string, unknown>, successTitle: string) => {
    setBusy(true);
    try {
      const result = await apiFetch<{ restored?: number; deleted?: number }>(
        "/api/trash",
        { method: "POST", body: JSON.stringify(body) }
      );
      toast({
        title: successTitle,
        description: t("actionResult", {
          count: result.restored ?? result.deleted ?? 0,
        }),
      });
      setSelected(new Set());
      invalidate();
    } catch (error) {
      toast({
        title: t("actionFailed"),
        description:
          error instanceof ApiClientError
            ? apiErrorMessage(tRoot, error.code, error.message)
            : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const selectedRefs = items
    .filter((it) => selected.has(it.id))
    .map((it) => ({ entity: it.entity, id: it.id }));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = items.length > 0 && items.every((it) => selected.has(it.id));

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {t("title")}
          </span>
        }
        description={t("description")}
        descriptionClassName="max-w-2xl"
        actions={
          <>
            {counts.total > 0 && (
              <Button
                variant="outline"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmEmpty(true)}
                disabled={busy}
              >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("emptyButton")}
            </Button>
            )}
          </>
        }
      />

      {/* ── Filters: entity chips + search ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label={t("entityFilterLabel")}
        >
          {(["ALL", ...ENTITY_ORDER] as EntityFilter[]).map((f) => {
            const active = entity === f;
            const count =
              f === "ALL" ? counts.total : counts[f as TrashEntity];
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setEntity(f);
                  setSelected(new Set());
                }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(`entities.${f}`)}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:w-72">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
            aria-label={t("searchPlaceholder")}
          />
          {search.length > 0 && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={t("clearSearch")}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedRefs.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2"
          role="toolbar"
          aria-label={t("bulkBarLabel")}
        >
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedRefs.length })}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "restore", items: selectedRefs },
                  t("restoredTitle")
                )
              }
            >
              <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />
              {t("restoreSelected")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "delete", items: selectedRefs },
                  t("deletedTitle")
                )
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("deleteSelected")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              {t("clearSelection")}
            </Button>
          </div>
        </div>
      )}

      {/* ── List ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{t("listTitle")}</CardTitle>
            {items.length > 0 && (
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) =>
                  setSelected(
                    v === true
                      ? new Set(items.map((it) => it.id))
                      : new Set()
                  )
                }
                aria-label={t("selectAll")}
              />
            )}
          </div>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {t("loadError")}
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Trash2
                className="h-10 w-10 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">{t("emptyTitle")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t("emptyDescription")}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const Icon = ENTITY_ICONS[item.entity];
                const isSel = selected.has(item.id);
                return (
                  <li
                    key={`${item.entity}-${item.id}`}
                    className="flex items-center gap-3 py-3"
                  >
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => toggle(item.id)}
                      aria-label={t("selectItem", { title: item.title })}
                      className="shrink-0"
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.title}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t(`entities.${item.entity}`)}
                        </span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {item.subtitle && <span className="tabular-nums">{item.subtitle}</span>}
                        <span aria-hidden="true">·</span>
                        <span>
                          {t("deletedOn", {
                            date: new Date(item.deletedAt).toLocaleDateString(
                              undefined,
                              { year: "numeric", month: "short", day: "numeric" }
                            ),
                          })}
                        </span>
                      </p>
                    </div>
                    <Badge
                      variant={item.daysRemaining <= 7 ? "destructive" : "secondary"}
                      className="shrink-0 tabular-nums"
                    >
                      <CalendarDays className="mr-1 h-3 w-3" aria-hidden="true" />
                      {t("daysRemaining", { count: item.daysRemaining })}
                    </Badge>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "restore",
                              items: [{ entity: item.entity, id: item.id }],
                            },
                            t("restoredTitle")
                          )
                        }
                        aria-label={t("restoreItem", { title: item.title })}
                        title={t("restoreItem", { title: item.title })}
                      >
                        <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t("restore")}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => setPendingDelete(item)}
                        aria-label={t("deleteItem", { title: item.title })}
                        title={t("deleteItem", { title: item.title })}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t("deleteForever")}</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Confirm: permanent delete one ── */}
      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteDescription", {
                title: pendingDelete?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  void act(
                    {
                      action: "delete",
                      items: [
                        { entity: pendingDelete.entity, id: pendingDelete.id },
                      ],
                    },
                    t("deletedTitle")
                  );
                }
                setPendingDelete(null);
              }}
            >
              {t("deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm: empty trash ── */}
      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmEmptyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmEmptyDescription", { count: counts.total })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void act({ action: "empty" }, t("deletedTitle"));
                setConfirmEmpty(false);
              }}
            >
              {t("emptyButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
