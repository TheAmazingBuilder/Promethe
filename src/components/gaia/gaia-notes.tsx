"use client";

/**
 * Gaïa — notes browser (list / grid, search with 300 ms debounce, 4 sorts,
 * tag filter chips, per-note actions and the move-to-folder dialog).
 *
 * Shared by the My Notes tab (view "all"), Favorites ("favorites") and the
 * folder view. Tag chips toggle tagId only, as specified (the server only
 * applies tagId when view === "tag"; the overview top-tags set view=tag
 * explicitly so they do filter).
 */
import * as React from "react";
import {
  Copy,
  FolderInput,
  Grid2x2,
  List,
  MoreVertical,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FolderChip,
  GaiaEmptyState,
  gaiaErrorMessage,
  gaiaRelativeTime,
  TagChip,
  useDuplicateGaiaNote,
  useGaiaFolders,
  useGaiaNotes,
  useGaiaTags,
  useTrashGaiaNote,
  useUpdateGaiaNote,
  type GaiaNoteRow,
  type GaiaNotesParams,
  type GaiaT,
} from "./gaia-shared";

function NoteMenu({
  note,
  onOpenNote,
  onMove,
  t,
}: {
  note: GaiaNoteRow;
  onOpenNote: (id: string) => void;
  onMove: (note: GaiaNoteRow) => void;
  t: GaiaT;
}) {
  const { toast } = useToast();
  const duplicateNote = useDuplicateGaiaNote();
  const trashNote = useTrashGaiaNote();
  const updateNote = useUpdateGaiaNote();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("gaia.shared.noteActions")}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-within:opacity-100"
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onOpenNote(note.id)}>
          {t("gaia.shared.openNote")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void duplicateNote.mutateAsync({ noteId: note.id }).then(
              (res) => onOpenNote(res.note.id),
              (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
            );
          }}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {t("gaia.shared.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMove(note)}>
          <FolderInput className="size-3.5" aria-hidden="true" />
          {t("gaia.notes.moveToFolder")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void updateNote.mutateAsync({
              noteId: note.id,
              patch: { favorite: !note.favorite },
            }).catch((err: unknown) =>
              toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
            );
          }}
        >
          <Star
            className={`size-3.5 ${note.favorite ? "fill-amber-400 text-amber-400" : ""}`}
            aria-hidden="true"
          />
          {note.favorite ? t("gaia.shared.removeFromFavorites") : t("gaia.shared.addToFavorites")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void trashNote.mutateAsync(note.id).catch((err: unknown) =>
              toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
            );
          }}
          className="text-loss focus:text-loss"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          {t("gaia.shared.moveToTrash")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoveDialog({
  note,
  onClose,
  t,
}: {
  note: GaiaNoteRow | null;
  onClose: () => void;
  t: GaiaT;
}) {
  const { toast } = useToast();
  const foldersQuery = useGaiaFolders();
  const updateNote = useUpdateGaiaNote();
  const [target, setTarget] = React.useState<string | null>(null);
  const [initializedFor, setInitializedFor] = React.useState<string | null>(null);
  // Adopt the note's current folder when the dialog opens.
  if (note && initializedFor !== note.id) {
    setInitializedFor(note.id);
    setTarget(note.folderId);
  }
  const folders = foldersQuery.data?.folders ?? [];
  return (
    <Dialog open={note !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="gaia-move-dialog">
        <DialogHeader>
          <DialogTitle>{t("gaia.notes.moveTitle")}</DialogTitle>
          <DialogDescription>
            “{note?.title === "" ? t("gaia.shared.untitledNote") : note?.title}” —{" "}
            {t("gaia.notes.movePickWhere")}
          </DialogDescription>
        </DialogHeader>
        <Select
          value={target === null ? "none" : target}
          onValueChange={(v) => setTarget(v === "none" ? null : v)}
        >
          <SelectTrigger aria-label={t("gaia.notes.targetFolder")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("gaia.shared.noFolder")}</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name} ({f.noteCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="gaia-move-confirm"
            disabled={!note || updateNote.isPending}
            onClick={() => {
              if (!note) return;
              void updateNote.mutateAsync({ noteId: note.id, patch: { folderId: target } }).then(
                () => onClose(),
                (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
              );
            }}
          >
            {t("gaia.notes.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotesBrowser({
  params,
  onParamsChange,
  onOpenNote,
  onCreateNote,
  emptyState,
  testid,
  showTagFilter = true,
}: {
  params: GaiaNotesParams;
  onParamsChange: (changes: Partial<GaiaNotesParams>) => void;
  onOpenNote: (noteId: string) => void;
  onCreateNote: (folderId?: string | null) => void;
  emptyState: { icon?: React.ReactNode; title: string; body: string };
  testid?: string;
  showTagFilter?: boolean;
}) {
  const t = useTranslations();
  const tr: GaiaT = (key) => t(key);
  const [layout, setLayout] = React.useState<"list" | "grid">("list");
  const [moveTarget, setMoveTarget] = React.useState<GaiaNoteRow | null>(null);

  const [rawQuery, setRawQuery] = React.useState(params.q);
  const [lastExternalQ, setLastExternalQ] = React.useState(params.q);
  if (params.q !== lastExternalQ) {
    setLastExternalQ(params.q);
    setRawQuery(params.q);
  }
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (rawQuery !== params.q) onParamsChange({ q: rawQuery });
    }, 300);
    return () => clearTimeout(timer);
  }, [rawQuery, params.q, onParamsChange]);

  const notesQuery = useGaiaNotes(params);
  const tagsQuery = useGaiaTags();
  const notes = notesQuery.data?.notes ?? [];
  const tags = (tagsQuery.data?.tags ?? []).filter((tag) => tag.noteCount > 0);

  return (
    <div data-testid={testid ?? "gaia-notes-panel"} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={t("gaia.notes.searchPlaceholder")}
            aria-label={t("gaia.notes.searchLabel")}
            data-testid="gaia-notes-search"
            className="pl-8"
          />
        </div>
        <Select
          value={params.sort}
          onValueChange={(v) => onParamsChange({ sort: v })}
        >
          <SelectTrigger className="h-9 w-40" aria-label={t("gaia.notes.sortLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">{t("gaia.notes.sortUpdated")}</SelectItem>
            <SelectItem value="created">{t("gaia.notes.sortCreated")}</SelectItem>
            <SelectItem value="title">{t("gaia.notes.sortTitle")}</SelectItem>
            <SelectItem value="viewed">{t("gaia.notes.sortViewed")}</SelectItem>
          </SelectContent>
        </Select>
        <div role="group" aria-label={t("gaia.notes.layoutLabel")} className="flex rounded-md border">
          <button
            type="button"
            aria-pressed={layout === "list"}
            aria-label={t("gaia.notes.listView")}
            title={t("gaia.notes.listView")}
            onClick={() => setLayout("list")}
            className={`rounded-l-md p-2 ${layout === "list" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
          >
            <List className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={layout === "grid"}
            aria-label={t("gaia.notes.gridView")}
            title={t("gaia.notes.gridView")}
            onClick={() => setLayout("grid")}
            className={`rounded-r-md p-2 ${layout === "grid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
          >
            <Grid2x2 className="size-4" aria-hidden="true" />
          </button>
        </div>
        <Button
          type="button"
          data-testid="gaia-new-note"
          className="h-9 bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() =>
            onCreateNote(params.view === "folder" ? params.folderId : null)
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("gaia.notes.newNote")}
        </Button>
      </div>

      {showTagFilter && tags.length > 0 ? (
        <div data-testid="gaia-tag-filter" className="flex flex-wrap gap-1.5" aria-label={t("gaia.shared.filterBy")}>
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              name={tag.name}
              active={params.tagId === tag.id}
              onClick={() =>
                onParamsChange({ tagId: params.tagId === tag.id ? "" : tag.id })
              }
            />
          ))}
        </div>
      ) : null}

      {notesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        params.q !== "" ? (
          <GaiaEmptyState
            icon={<Search className="size-8" aria-hidden="true" />}
            title={t("gaia.notes.emptySearchTitle")}
            body={t("gaia.notes.emptySearchBody")}
            testid="gaia-notes-empty-search"
          />
        ) : (
          <GaiaEmptyState
            icon={emptyState.icon}
            title={emptyState.title}
            body={emptyState.body}
            testid="gaia-notes-empty"
            action={
              <Button type="button" size="sm" onClick={() => onCreateNote(null)}>
                <Plus className="size-4" aria-hidden="true" />
                {t("gaia.overview.createFirstNote")}
              </Button>
            }
          />
        )
      ) : layout === "list" ? (
        <ul data-testid="gaia-notes-list" className="divide-y divide-border rounded-lg border bg-card">
          {notes.map((note) => (
            <li key={note.id}>
              <div
                role="button"
                tabIndex={0}
                data-testid="gaia-note-row"
                aria-label={`${t("gaia.shared.openNote")} ${note.title === "" ? t("gaia.shared.untitledNote") : note.title}`}
                onClick={() => onOpenNote(note.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenNote(note.id);
                }}
                className="group flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40"
              >
                <span className="pt-0.5 text-lg leading-none" aria-hidden="true">
                  {note.icon ?? "📝"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {note.title === "" ? t("gaia.shared.untitledNote") : note.title}
                    </span>
                    {note.favorite ? (
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
                    ) : null}
                    {note.todoOpen > 0 ? (
                      <span
                        title={t("gaia.notes.openToDos")}
                        className="shrink-0 font-mono text-[10px] text-muted-foreground"
                      >
                        {note.todoOpen}○
                      </span>
                    ) : null}
                    {note.refCount > 0 ? (
                      <span
                        title={t("gaia.notes.refs")}
                        className="shrink-0 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
                      >
                        {note.refCount} {note.refCount === 1 ? t("gaia.shared.refOne") : t("gaia.shared.refMany")}
                      </span>
                    ) : null}
                  </span>
                  {note.excerpt ? (
                    <span className="block truncate text-xs text-muted-foreground">{note.excerpt}</span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <FolderChip name={note.folderName} />
                    {note.tagNames.slice(0, 3).map((name) => (
                      <TagChip key={name} name={name} />
                    ))}
                    <span className="text-[11px] text-muted-foreground/70">
                      {t("gaia.shared.edited")} {gaiaRelativeTime(note.updatedAt, tr)}
                    </span>
                  </span>
                </span>
                <NoteMenu note={note} onOpenNote={onOpenNote} onMove={setMoveTarget} t={tr} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div data-testid="gaia-notes-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {notes.map((note) => (
            <div
              key={note.id}
              role="button"
              tabIndex={0}
              data-testid="gaia-note-card"
              aria-label={`${t("gaia.shared.openNote")} ${note.title === "" ? t("gaia.shared.untitledNote") : note.title}`}
              onClick={() => onOpenNote(note.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenNote(note.id);
              }}
              className="group cursor-pointer rounded-lg border bg-card p-4 hover:border-emerald-500/40 hover:bg-muted/30"
            >
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none" aria-hidden="true">
                  {note.icon ?? "📝"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {note.title === "" ? t("gaia.shared.untitledNote") : note.title}
                </span>
                <NoteMenu note={note} onOpenNote={onOpenNote} onMove={setMoveTarget} t={tr} />
              </div>
              <p className="mt-2 line-clamp-3 min-h-10 text-xs text-muted-foreground">
                {note.excerpt === "" ? (
                  <em>{t("gaia.notes.emptyNote")}</em>
                ) : (
                  note.excerpt
                )}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                {note.favorite ? (
                  <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
                ) : null}
                <FolderChip name={note.folderName} />
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {gaiaRelativeTime(note.updatedAt, tr)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <MoveDialog note={moveTarget} onClose={() => setMoveTarget(null)} t={tr} />
    </div>
  );
}
