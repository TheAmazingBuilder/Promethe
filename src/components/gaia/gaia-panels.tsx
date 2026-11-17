"use client";

/**
 * Gaïa — tab panels: Overview, Folders, Templates, Trash, plus the compact
 * note row used by the overview.
 */
import * as React from "react";
import {
  Check,
  FileText,
  Folder,
  FolderPlus,
  LayoutTemplate,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  GaiaEmptyState,
  gaiaErrorMessage,
  gaiaRelativeTime,
  TagChip,
  useCreateGaiaFolder,
  useDeleteGaiaFolder,
  useGaiaFolders,
  useGaiaOverview,
  useGaiaTemplates,
  useGaiaNotes,
  useInstantiateGaiaTemplate,
  usePurgeGaiaNote,
  useRestoreGaiaNote,
  useUpdateGaiaFolder,
  type GaiaBlock,
  type GaiaNotesParams,
  type GaiaNoteRow,
  type GaiaTab,
  type GaiaT,
} from "./gaia-shared";
import { blockTypeLabel } from "./gaia-blocks";

// ── Compact row ──────────────────────────────────────────────────────────────

export function CompactNoteRow({
  note,
  onOpenNote,
  t,
}: {
  note: GaiaNoteRow;
  onOpenNote: (id: string) => void;
  t: GaiaT;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenNote(note.id)}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
    >
      <span className="text-base leading-none" aria-hidden="true">
        {note.icon ?? "📝"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {note.title === "" ? t("gaia.shared.untitledNote") : note.title}
          </span>
          {note.favorite ? (
            <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {note.folderName ? `${note.folderName} · ` : ""}
          {t("gaia.shared.edited")} {gaiaRelativeTime(note.updatedAt, t)}
        </span>
      </span>
    </button>
  );
}

function StatCell({
  value,
  label,
  hint,
  testid,
}: {
  value: number;
  label: string;
  hint: string;
  testid: string;
}) {
  return (
    <div data-testid={testid} title={hint} className="rounded-lg border bg-card p-4">
      <p className="font-mono text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

export function OverviewPanel({
  onGoTab,
  onOpenNote,
  onCreateNote,
}: {
  onGoTab: (tab: GaiaTab, params?: Partial<GaiaNotesParams>) => void;
  onOpenNote: (noteId: string) => void;
  onCreateNote: (folderId?: string | null) => void;
}) {
  const t = useTranslations();
  const tr: GaiaT = (key) => t(key);
  const overviewQuery = useGaiaOverview();
  const data = overviewQuery.data;

  if (overviewQuery.isLoading || !data) {
    return (
      <div data-testid="gaia-overview" className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const maxActivity = Math.max(
    1,
    ...data.activity.map((w) => w.created + w.edited),
  );

  return (
    <div data-testid="gaia-overview" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCell value={data.totals.notes} label={t("gaia.overview.statNotes")} hint={t("gaia.overview.statNotesHint")} testid="gaia-stat-notes" />
        <StatCell value={data.totals.createdThisWeek} label={t("gaia.overview.statCreated")} hint={t("gaia.overview.statCreatedHint")} testid="gaia-stat-created" />
        <StatCell value={data.totals.favorites} label={t("gaia.overview.statFavorites")} hint={t("gaia.overview.statFavoritesHint")} testid="gaia-stat-favorites" />
        <StatCell value={data.totals.folders} label={t("gaia.overview.statFolders")} hint={t("gaia.overview.statFoldersHint")} testid="gaia-stat-folders" />
      </div>

      <div data-testid="gaia-quick-actions" className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="gaia-quick-new-note"
          className="bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() => onCreateNote(null)}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("gaia.overview.newNote")}
        </Button>
        <Button type="button" variant="outline" onClick={() => onGoTab("folders")}>
          <FolderPlus className="size-4" aria-hidden="true" />
          {t("gaia.overview.newFolder")}
        </Button>
        <Button type="button" variant="outline" onClick={() => onGoTab("templates")}>
          <LayoutTemplate className="size-4" aria-hidden="true" />
          {t("gaia.overview.fromTemplate")}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section data-testid="gaia-recent-edited" className="rounded-xl border bg-card p-4 xl:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t("gaia.overview.recentEditedTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("gaia.overview.recentEditedHint")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onGoTab("notes")}>
              {t("gaia.overview.allNotes")}
            </Button>
          </div>
          {data.recentEdited.length === 0 ? (
            <div className="mt-3">
              <GaiaEmptyState
                icon={<FileText className="size-8" aria-hidden="true" />}
                title={t("gaia.overview.emptyTitle")}
                body={t("gaia.overview.emptyBody")}
                testid="gaia-overview-empty"
                action={
                  <Button type="button" size="sm" onClick={() => onCreateNote(null)}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t("gaia.overview.createFirstNote")}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="mt-2 space-y-0.5">
              {data.recentEdited.map((note) => (
                <CompactNoteRow key={note.id} note={note} onOpenNote={onOpenNote} t={tr} />
              ))}
            </div>
          )}
        </section>

        <section data-testid="gaia-recent-viewed" className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">{t("gaia.overview.recentViewedTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("gaia.overview.recentViewedHint")}</p>
          {data.recentViewed.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              {t("gaia.overview.recentViewedEmpty")}
            </p>
          ) : (
            <div className="mt-2 space-y-0.5">
              {data.recentViewed.map((note) => (
                <CompactNoteRow key={note.id} note={note} onOpenNote={onOpenNote} t={tr} />
              ))}
            </div>
          )}
        </section>

        <section data-testid="gaia-favorites-shelf" className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("gaia.overview.favoritesTitle")}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => onGoTab("favorites")}>
              {t("gaia.overview.viewAll")}
            </Button>
          </div>
          {data.favorites.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("gaia.overview.favoritesEmpty")}</p>
          ) : (
            <div className="mt-2 space-y-0.5">
              {data.favorites.map((note) => (
                <CompactNoteRow key={note.id} note={note} onOpenNote={onOpenNote} t={tr} />
              ))}
            </div>
          )}
        </section>

        <section data-testid="gaia-overview-folders" className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("gaia.overview.foldersTitle")}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => onGoTab("folders")}>
              {t("gaia.overview.manage")}
            </Button>
          </div>
          {data.folders.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("gaia.overview.foldersEmpty")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {data.folders.slice(0, 6).map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => onGoTab("folders")}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{folder.noteCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section data-testid="gaia-activity" className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">{t("gaia.overview.activityTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("gaia.overview.activityHint")}</p>
          <div className="mt-3 flex items-end gap-1.5">
            {data.activity.map((week) => (
              <div key={week.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className="flex h-20 w-full max-w-8 flex-col justify-end overflow-hidden rounded-sm"
                  title={`${week.weekStart}: ${week.created} ${t("gaia.overview.legendCreated")}, ${week.edited} ${t("gaia.overview.legendEdited")}`}
                >
                  <div
                    className="w-full bg-emerald-500/70"
                    style={{ height: `${Math.round((week.edited / maxActivity) * 100)}%` }}
                  />
                  <div
                    className="w-full bg-emerald-500"
                    style={{ height: `${Math.round((week.created / maxActivity) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground">
                  {week.weekStart.slice(5).replace("-", "/")}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-500" aria-hidden="true" />
              {t("gaia.overview.legendCreated")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-500/70" aria-hidden="true" />
              {t("gaia.overview.legendEdited")}
            </span>
          </div>
          {data.topTags.length > 0 ? (
            <div data-testid="gaia-top-tags" className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("gaia.overview.mostUsedTags")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.topTags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    name={tag.name}
                    onClick={() => onGoTab("notes", { view: "tag", tagId: tag.id })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

// ── Folders ──────────────────────────────────────────────────────────────────

export function FoldersPanel({
  onOpenFolder,
  onCreateNoteInFolder,
}: {
  onOpenFolder: (folderId: string) => void;
  onCreateNoteInFolder: (folderId: string) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const foldersQuery = useGaiaFolders();
  const createFolder = useCreateGaiaFolder();
  const updateFolder = useUpdateGaiaFolder();
  const deleteFolder = useDeleteGaiaFolder();
  const [name, setName] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string; noteCount: number } | null>(null);

  const folders = foldersQuery.data?.folders ?? [];

  const create = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    void createFolder.mutateAsync(trimmed).then(
      () => setName(""),
      (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
    );
  };

  return (
    <div data-testid="gaia-folders-panel" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder={t("gaia.folders.inputPlaceholder")}
          aria-label={t("gaia.folders.inputLabel")}
          data-testid="gaia-folder-name-input"
          className="max-w-md"
        />
        <Button
          type="button"
          data-testid="gaia-folder-create"
          disabled={name.trim() === "" || createFolder.isPending}
          onClick={create}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("gaia.folders.create")}
        </Button>
      </div>

      {foldersQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <GaiaEmptyState
          icon={<Folder className="size-8" aria-hidden="true" />}
          title={t("gaia.folders.emptyTitle")}
          body={t("gaia.folders.emptyBody")}
          testid="gaia-folders-empty"
        />
      ) : (
        <div data-testid="gaia-folders-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {folders.map((folder) => (
            <div
              key={folder.id}
              data-testid="gaia-folder-card"
              className="group rounded-lg border bg-card p-4 hover:border-emerald-500/40"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  data-testid="gaia-folder-open"
                  onClick={() => onOpenFolder(folder.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Folder className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{folder.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {folder.noteCount}{" "}
                      {folder.noteCount === 1 ? t("gaia.shared.noteOne") : t("gaia.shared.noteMany")}
                    </span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${t("gaia.folders.optionsFor")} ${folder.name}`}
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-within:opacity-100"
                    >
                      <MoreVertical className="size-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameTarget({ id: folder.id, name: folder.name });
                        setRenameName(folder.name);
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      {t("gaia.folders.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setDeleteTarget({ id: folder.id, name: folder.name, noteCount: folder.noteCount })
                      }
                      className="text-loss focus:text-loss"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {t("gaia.folders.deleteFolder")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onCreateNoteInFolder(folder.id)}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t("gaia.folders.newNoteHere")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("gaia.folders.renameTitle")}</DialogTitle>
            <DialogDescription>{t("gaia.folders.renameBody")}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget && renameName.trim() !== "") {
                void updateFolder
                  .mutateAsync({ folderId: renameTarget.id, name: renameName.trim() })
                  .then(
                    () => setRenameTarget(null),
                    (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                  );
              }
            }}
            aria-label={t("gaia.folders.folderName")}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={renameName.trim() === ""}
              onClick={() => {
                if (!renameTarget) return;
                void updateFolder
                  .mutateAsync({ folderId: renameTarget.id, name: renameName.trim() })
                  .then(
                    () => setRenameTarget(null),
                    (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                  );
              }}
            >
              <Check className="size-4" aria-hidden="true" />
              {t("gaia.folders.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm" data-testid="gaia-folder-delete-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("gaia.folders.deleteTitlePrefix")} “{deleteTarget?.name}”?
            </DialogTitle>
            <DialogDescription>
              {t("gaia.folders.deleteBodyPrefix")} {deleteTarget?.noteCount}{" "}
              {deleteTarget && deleteTarget.noteCount === 1
                ? t("gaia.shared.noteOne")
                : t("gaia.shared.noteMany")}{" "}
              {t("gaia.folders.deleteBodySuffix")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="gaia-folder-delete-confirm"
              onClick={() => {
                if (!deleteTarget) return;
                void deleteFolder.mutateAsync(deleteTarget.id).then(
                  () => setDeleteTarget(null),
                  (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                );
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("gaia.folders.deleteFolder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────

function templatePreviewBlock(block: GaiaBlock, t: GaiaT): React.ReactNode {
  const text = block.text === "" ? null : block.text;
  if (block.type === "table") return <span>{t("gaia.templates.tablePreview")}</span>;
  if (block.type === "divider") return <span>—</span>;
  if (block.type === "todo") return <span>☐ {text ?? ""}</span>;
  if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
    return (
      <span className="font-semibold text-foreground">
        {text ?? <em>{`${t("gaia.templates.emptyPrefix")} ${blockTypeLabel(block.type, t)}`}</em>}
      </span>
    );
  }
  if (!text) {
    return (
      <em>{`${t("gaia.templates.emptyPrefix")} ${blockTypeLabel(block.type, t)}`}</em>
    );
  }
  return <span className="truncate">{text}</span>;
}

export function TemplatesPanel({ onOpenNote }: { onOpenNote: (noteId: string) => void }) {
  const t = useTranslations();
  const { toast } = useToast();
  const templatesQuery = useGaiaTemplates();
  const instantiate = useInstantiateGaiaTemplate();
  const templates = templatesQuery.data?.templates ?? [];

  return (
    <div data-testid="gaia-templates-panel" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("gaia.templates.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("gaia.templates.hint")}</p>
      </div>
      {templatesQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <GaiaEmptyState
          icon={<LayoutTemplate className="size-8" aria-hidden="true" />}
          title={t("gaia.templates.emptyTitle")}
          body={t("gaia.templates.emptyBody")}
          testid="gaia-templates-empty"
        />
      ) : (
        <div data-testid="gaia-templates-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} data-testid="gaia-template-card" className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-lg">
                  {template.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{template.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {template.builtIn ? t("gaia.templates.builtin") : t("gaia.templates.custom")} ·{" "}
                    {template.blocks.length}{" "}
                    {template.blocks.length === 1
                      ? t("gaia.templates.blocksOne")
                      : t("gaia.templates.blocksMany")}
                  </span>
                </span>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 text-sm text-muted-foreground">
                {template.description}
              </p>
              <div className="mt-2 min-h-16 space-y-1 rounded-md border bg-background/60 p-2 text-[11px] text-muted-foreground">
                {template.blocks.slice(0, 4).map((block) => (
                  <div key={block.id} className="truncate">
                    {templatePreviewBlock(block, (key) => t(key))}
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                data-testid={`gaia-template-use-${template.id}`}
                disabled={instantiate.isPending}
                onClick={() => {
                  void instantiate.mutateAsync({ templateId: template.id }).then(
                    (res) => onOpenNote(res.note.id),
                    (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                  );
                }}
              >
                <FileText className="size-4" aria-hidden="true" />
                {t("gaia.templates.use")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trash ────────────────────────────────────────────────────────────────────

export function TrashPanel() {
  const t = useTranslations();
  const tr: GaiaT = (key) => t(key);
  const { toast } = useToast();
  const trashQuery = useGaiaNotes({
    view: "trash",
    folderId: "",
    tagId: "",
    q: "",
    sort: "updated",
  });
  const restoreNote = useRestoreGaiaNote();
  const purgeNote = usePurgeGaiaNote();
  const [purgeTarget, setPurgeTarget] = React.useState<GaiaNoteRow | "all" | null>(null);

  const notes = trashQuery.data?.notes ?? [];

  const purgeAll = async () => {
    for (const note of notes) {
      try {
        await purgeNote.mutateAsync(note.id);
      } catch (err) {
        toast({ variant: "destructive", title: gaiaErrorMessage(err) });
        return;
      }
    }
    setPurgeTarget(null);
  };

  return (
    <div data-testid="gaia-trash-panel" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("gaia.trash.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("gaia.trash.hint")}</p>
        </div>
        {notes.length > 0 ? (
          <Button type="button" variant="outline" onClick={() => setPurgeTarget("all")}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t("gaia.trash.empty")}
          </Button>
        ) : null}
      </div>

      {trashQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <GaiaEmptyState
          icon={<Trash2 className="size-8" aria-hidden="true" />}
          title={t("gaia.trash.emptyTitle")}
          body={t("gaia.trash.emptyBody")}
          testid="gaia-trash-empty"
        />
      ) : (
        <ul data-testid="gaia-trash-list" className="divide-y rounded-lg border bg-card">
          {notes.map((note) => (
            <li key={note.id} data-testid="gaia-trash-row" className="flex items-center gap-3 px-3 py-2.5">
              <span className="text-lg leading-none" aria-hidden="true">
                {note.icon ?? "📝"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {note.title === "" ? t("gaia.shared.untitledNote") : note.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("gaia.shared.deleted")}{" "}
                  {note.deletedAt ? gaiaRelativeTime(note.deletedAt, tr) : ""} ·{" "}
                  {t("gaia.shared.created")} {gaiaRelativeTime(note.createdAt, tr)}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0"
                data-testid={`gaia-trash-restore-${note.id}`}
                onClick={() => {
                  void restoreNote.mutateAsync(note.id).catch((err: unknown) =>
                    toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                  );
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t("gaia.shared.restore")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 text-loss hover:text-loss"
                onClick={() => setPurgeTarget(note)}
              >
                {t("gaia.trash.deleteForever")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={purgeTarget !== null} onOpenChange={(open) => { if (!open) setPurgeTarget(null); }}>
        <DialogContent className="max-w-sm" data-testid="gaia-purge-dialog">
          <DialogHeader>
            <DialogTitle>
              {purgeTarget === "all"
                ? t("gaia.trash.purgeAllTitle")
                : `${t("gaia.trash.purgeSinglePrefix")} “${purgeTarget?.title === "" ? t("gaia.shared.untitledNote") : purgeTarget?.title}” ${t("gaia.trash.purgeSingleSuffix")}`}
            </DialogTitle>
            <DialogDescription>
              {purgeTarget === "all"
                ? `${t("gaia.trash.purgeBodyCountPrefix")} ${notes.length} ${notes.length === 1 ? t("gaia.shared.noteOne") : t("gaia.shared.noteMany")} ${t("gaia.trash.purgeBodyCountSuffix")}`
                : t("gaia.trash.purgeBodySingle")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPurgeTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="gaia-purge-confirm"
              disabled={purgeNote.isPending}
              onClick={() => {
                if (purgeTarget === "all") {
                  void purgeAll();
                } else if (purgeTarget) {
                  void purgeNote.mutateAsync(purgeTarget.id).then(
                    () => setPurgeTarget(null),
                    (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                  );
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {purgeTarget === "all" ? t("gaia.trash.empty") : t("gaia.trash.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
