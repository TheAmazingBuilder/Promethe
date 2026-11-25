"use client";

/**
 * Gaïa — editor dialogs: entity reference picker, version history and the
 * emoji icon picker.
 */
import * as React from "react";
import { Check, History, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GAIA_REF_KINDS,
  GAIA_REF_META,
  gaiaRefLabel,
  gaiaRelativeTime,
  useGaiaRefs,
  useGaiaVersion,
  useGaiaVersions,
  type GaiaBlock,
  type GaiaRefHit,
  type GaiaRefKind,
  type GaiaT,
} from "./gaia-shared";
import { textOfBlocks } from "@/lib/gaia/content";
import { diffGaiaText } from "@/lib/gaia/version-diff";

// ── Ref picker ───────────────────────────────────────────────────────────────

export function RefPickerDialog({
  open,
  onOpenChange,
  kind,
  onPick,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: GaiaRefKind | "";
  onPick: (hit: GaiaRefHit) => void;
  t: GaiaT;
}) {
  const [kindFilter, setKindFilter] = React.useState<GaiaRefKind | "">(kind);
  const [rawQuery, setRawQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  React.useEffect(() => {
    if (open) {
      setKindFilter(kind);
      setRawQuery("");
      setQuery("");
      setActiveIndex(0);
    }
  }, [open, kind]);

  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const refsQuery = useGaiaRefs(query, kindFilter, open);
  const hits = refsQuery.data?.refs ?? [];

  React.useEffect(() => {
    setActiveIndex(0);
  }, [hits.length, kindFilter, query]);

  const choose = (hit: GaiaRefHit) => {
    onPick(hit);
    onOpenChange(false);
  };

  const filters: Array<GaiaRefKind | ""> = ["", ...GAIA_REF_KINDS];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="gaia-ref-picker"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(hits.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && hits[activeIndex]) {
            e.preventDefault();
            choose(hits[activeIndex]);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("gaia.dialogs.refPickerTitle")}</DialogTitle>
          <DialogDescription>{t("gaia.dialogs.refPickerBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((k) => {
            const active = kindFilter === k;
            return (
              <button
                key={k === "" ? "ALL" : k}
                type="button"
                data-testid={`gaia-ref-kind-${k === "" ? "ALL" : k}`}
                onClick={() => setKindFilter(k)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  active
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {k === "" ? t("gaia.dialogs.all") : gaiaRefLabel(k, t)}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={t("gaia.dialogs.searchPlaceholder")}
            aria-label={t("gaia.dialogs.searchLabel")}
            autoFocus
            className="pl-8"
          />
        </div>
        <div
          data-testid="gaia-ref-list"
          className="max-h-80 min-h-40 overflow-y-auto rounded-lg border"
        >
          {refsQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("gaia.dialogs.noMatch")}
            </p>
          ) : (
            <ul className="divide-y">
              {hits.map((hit, i) => {
                const meta = GAIA_REF_META[hit.kind];
                const Icon = meta.icon;
                return (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button
                      type="button"
                      data-testid="gaia-ref-hit"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => choose(hit)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                        i === activeIndex ? "bg-emerald-500/10" : ""
                      }`}
                    >
                      <Icon className="size-4 shrink-0" style={{ color: meta.hue }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{hit.label}</span>
                        {hit.meta ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.meta}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                        {gaiaRefLabel(hit.kind, t)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Versions ─────────────────────────────────────────────────────────────────

export function VersionsDialog({
  open,
  onOpenChange,
  noteId,
  currentBlocks,
  onRestore,
  restoringId,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  /** Current note content, to diff the selected version against. */
  currentBlocks: GaiaBlock[];
  onRestore: (versionId: string) => void;
  restoringId?: string | null;
  t: GaiaT;
}) {
  const versionsQuery = useGaiaVersions(noteId, open);
  const versions = versionsQuery.data?.versions ?? [];
  // Lot 11 (roadmap §15): clicking a version previews it and diffs it
  // against the current note. Restore only happens from the preview,
  // after the user has seen what changes.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const detailQuery = useGaiaVersion(noteId, open ? selectedId : null);
  const detail = detailQuery.data?.version ?? null;
  const diff = React.useMemo(() => {
    if (!detail) return null;
    return diffGaiaText(textOfBlocks(detail.blocks), textOfBlocks(currentBlocks));
  }, [detail, currentBlocks]);
  const previewLines = detail ? textOfBlocks(detail.blocks).split("\n").filter((l) => l.trim() !== "") : [];

  React.useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="gaia-versions-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {t("gaia.dialogs.versionsTitle")}
          </DialogTitle>
          <DialogDescription>{t("gaia.dialogs.versionsBody")}</DialogDescription>
        </DialogHeader>
        {versionsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("gaia.dialogs.versionsEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul data-testid="gaia-versions-list" className="max-h-64 space-y-2 overflow-y-auto">
              {versions.map((v) => (
                <li
                  key={v.id}
                  data-testid="gaia-version-row"
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${selectedId === v.id ? "border-emerald-500/50 bg-emerald-500/5" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(selectedId === v.id ? null : v.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium">
                      {v.title === "" ? t("gaia.shared.untitledNote") : v.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {gaiaRelativeTime(v.savedAt, t)} · {v.wordCount}{" "}
                      {v.wordCount === 1 ? t("gaia.shared.wordOne") : t("gaia.shared.wordMany")}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    disabled={restoringId === v.id}
                    onClick={() => setSelectedId(v.id)}
                  >
                    {t("gaia.dialogs.versionPreview")}
                  </Button>
                </li>
              ))}
            </ul>
            {selected ? (
              <div data-testid="gaia-version-preview" className="rounded-lg border p-3">
                <p className="text-sm font-semibold">
                  {selected.title === "" ? t("gaia.shared.untitledNote") : selected.title}
                </p>
                {detailQuery.isLoading ? (
                  <div className="mt-2 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : detail == null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("gaia.dialogs.versionLoadError")}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                      {previewLines.length === 0
                        ? t("gaia.dialogs.versionEmpty")
                        : previewLines.slice(0, 8).join("\n")}
                    </p>
                    {diff ? (
                      <div className="mt-2 text-xs">
                        <p className="font-medium">
                          {t("gaia.dialogs.versionDiffTitle")}{" "}
                          <span className="text-gain">+{diff.added.length}</span>
                          {" / "}
                          <span className="text-loss">−{diff.removed.length}</span>
                        </p>
                        {diff.added.length > 0 ? (
                          <ul className="mt-1 space-y-0.5">
                            {diff.added.slice(0, 5).map((line) => (
                              <li key={line} className="truncate text-gain">+ {line}</li>
                            ))}
                          </ul>
                        ) : null}
                        {diff.removed.length > 0 ? (
                          <ul className="mt-1 space-y-0.5">
                            {diff.removed.slice(0, 5).map((line) => (
                              <li key={line} className="truncate text-loss">− {line}</li>
                            ))}
                          </ul>
                        ) : null}
                        {diff.added.length === 0 && diff.removed.length === 0 ? (
                          <p className="mt-1 text-muted-foreground">
                            {t("gaia.dialogs.versionDiffNone")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={restoringId === selected.id}
                        onClick={() => onRestore(selected.id)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        {t("gaia.shared.restore")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Icon picker ──────────────────────────────────────────────────────────────

export const GAIA_ICONS = [
  "📝", "📈", "📉", "🧠", "💡", "📊", "🔬", "✅", "📚", "🎯", "⚠️", "🧭",
  "🔍", "🛠️", "🧾", "🗓️", "⚡", "🥇", "🌱", "🔥", "💎", "🎓", "🧩", "📦",
  "🪙", "💵", "🏦", "🛡️", "⏱️", "🧊", "🌊", "🌪️", "🚀", "🪤", "🕹️", "🧮",
];

export function IconPicker({
  icon,
  onPick,
  t,
}: {
  icon: string | null;
  onPick: (icon: string | null) => void;
  t: GaiaT;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="gaia-icon-button"
          aria-label={t("gaia.dialogs.changeIconAria")}
          title={t("gaia.dialogs.changeIconTitle")}
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent text-2xl hover:border-border hover:bg-muted"
        >
          {icon ?? "📝"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div data-testid="gaia-icon-grid" className="grid grid-cols-6 gap-1">
          {GAIA_ICONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className={`flex size-9 items-center justify-center rounded-md text-lg hover:bg-muted ${
                (icon ?? "📝") === emoji ? "bg-emerald-500/15" : ""
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <Check className="size-3.5" aria-hidden="true" />
          {t("gaia.dialogs.removeIcon")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
