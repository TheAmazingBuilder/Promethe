"use client";

/**
 * Gaïa — block editor.
 *
 * Local draft is the source of truth; the server is synced by a 900 ms
 * debounced autosave (single PATCH with the whole draft). Save status is
 * always visible. Slash commands, Markdown shortcuts, drag-and-drop reorder,
 * Ctrl+S / Ctrl+B / Ctrl+I, Markdown + PDF export, version history and the
 * emoji icon picker all live here.
 */
import * as React from "react";
import {
  CandlestickChart,
  Download,
  FileDown,
  History,
  Maximize2,
  Minimize2,
  Star,
  Tag,
  X,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { navigate } from "@/lib/router";
import {
  gaiaErrorMessage,
  gaiaRelativeTime,
  newBlockId,
  useCreateGaiaNote,
  useCreateGaiaTag,
  useCreateGaiaTemplate,
  useDuplicateGaiaNote,
  useGaiaFolders,
  useGaiaNote,
  useGaiaTags,
  useRestoreGaiaVersion,
  useTrashGaiaNote,
  useUpdateGaiaNote,
  type GaiaBlock,
  type GaiaRefHit,
  type GaiaRefKind,
  type GaiaT,
} from "./gaia-shared";
import {
  GaiaBlockRow,
  GaiaSlashMenu,
  numberedIndexFor,
  slashItemsFor,
  type GaiaBlockOps,
  type GaiaSlashItem,
} from "./gaia-blocks";
import { IconPicker, RefPickerDialog, VersionsDialog } from "./gaia-editor-dialogs";
import { NotePrintDialog } from "./gaia-print";
import { GaiaLinkedNotesSection } from "./gaia-linked-notes";
import { GaiaPatternLibrary } from "./gaia-pattern-library";
import { getCandlestickPattern, isCandlestickPatternId } from "@/lib/gaia/patterns/catalog";
import {
  clearLocalGaiaDraft,
  gaiaSaveRetryDelay,
  isLocalDraftNewer,
  loadLocalGaiaDraft,
  saveLocalGaiaDraft,
} from "@/lib/gaia/draft-recovery";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

interface DraftState {
  title: string;
  icon: string | null;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
  blocks: GaiaBlock[];
}

function emptyDraft(): DraftState {
  return {
    title: "",
    icon: null,
    folderId: null,
    tagIds: [],
    favorite: false,
    blocks: [{ id: newBlockId(), type: "paragraph", text: "" }],
  };
}

function countWords(blocks: GaiaBlock[]): number {
  let n = 0;
  for (const block of blocks) {
    if (block.text.trim() !== "") n += block.text.trim().split(/\s+/).length;
    if (block.type === "table" && block.rows) {
      for (const row of block.rows)
        for (const cell of row)
          if (cell.trim() !== "") n += cell.trim().split(/\s+/).length;
    }
  }
  return n;
}

export function blocksToMarkdown(
  title: string,
  blocks: GaiaBlock[],
  t: GaiaT,
): string {
  const lines: string[] = [`# ${title === "" ? t("gaia.shared.untitledNote") : title}`, ""];
  const refLabel = (kind: GaiaRefKind) => t(`gaia.refKinds.${kind.toLowerCase()}`);
  for (const block of blocks) {
    switch (block.type) {
      case "h1":
        lines.push(`# ${block.text}`, "");
        break;
      case "h2":
        lines.push(`## ${block.text}`, "");
        break;
      case "h3":
        lines.push(`### ${block.text}`, "");
        break;
      case "bullet":
        lines.push(`- ${block.text}`);
        break;
      case "numbered":
        lines.push(`1. ${block.text}`);
        break;
      case "todo":
        lines.push(`- [${block.checked ? "x" : " "}] ${block.text}`);
        break;
      case "quote":
        lines.push(`> ${block.text}`, "");
        break;
      case "callout":
        lines.push(`> **${(block.tone ?? "info").toUpperCase()}** — ${block.text}`, "");
        break;
      case "code":
        lines.push("```", block.text, "```", "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "image": {
        if (block.src) lines.push(`![${block.alt ?? block.caption ?? "image"}](${block.src})`);
        if (block.caption) lines.push(`*${block.caption}*`);
        lines.push("");
        break;
      }
      case "table": {
        const rows = block.rows ?? [];
        if (rows.length > 0) {
          lines.push(`| ${rows[0]!.join(" | ")} |`);
          lines.push(`| ${rows[0]!.map(() => "---").join(" | ")} |`);
          for (const row of rows.slice(1)) lines.push(`| ${row.join(" | ")} |`);
          lines.push("");
        }
        break;
      }
      case "pattern": { const pattern = block.patternId ? getCandlestickPattern(block.patternId) : null; if (pattern) lines.push(`![${pattern.name}](${pattern.illustration})`, `*${pattern.description}*`, ""); break; }
      case "ref": {
        if (block.ref) {
          const kindLabel = refLabel(block.ref.kind);
          const label = block.ref.label ?? kindLabel;
          lines.push(
            `> **${kindLabel}** — ${label}${block.ref.href ? ` (${block.ref.href})` : ""}`,
            "",
          );
        }
        break;
      }
      default:
        lines.push(block.text, "");
    }
  }
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "note" : slug;
}

export function GaiaEditor({
  noteId,
  onClose,
  onOpenNote,
  focusMode,
  onToggleFocusMode,
}: {
  noteId: string;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
}) {
  const t = useTranslations();
  const tr = React.useCallback<GaiaT>((key) => t(key), [t]);
  const { toast } = useToast();
  const noteQuery = useGaiaNote(noteId);
  const foldersQuery = useGaiaFolders();
  const tagsQuery = useGaiaTags();
  const updateNote = useUpdateGaiaNote();
  const trashNote = useTrashGaiaNote();
  const duplicateNote = useDuplicateGaiaNote();
  const createTag = useCreateGaiaTag();
  const createTemplate = useCreateGaiaTemplate();
  const restoreVersion = useRestoreGaiaVersion();
  const createGaiaNote = useCreateGaiaNote();

  const [draft, setDraft] = React.useState<DraftState | null>(null);
  const [status, setStatus] = React.useState<SaveStatus>("saved");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [patternLibraryOpen, setPatternLibraryOpen] = React.useState(false);
  const [refPicker, setRefPicker] = React.useState<{
    open: boolean;
    kind: GaiaRefKind | "";
    sourceBlockId: string | null;
  }>({ open: false, kind: "", sourceBlockId: null });
  const [slash, setSlash] = React.useState<{
    blockId: string;
    query: string;
    rect: { top: number; left: number };
  } | null>(null);
  const [slashActive, setSlashActive] = React.useState(0);
  const [dragState, setDragState] = React.useState<{
    dragId: string | null;
    overId: string | null;
    position: "above" | "below" | null;
  }>({ dragId: null, overId: null, position: null });
  const [newTagName, setNewTagName] = React.useState("");
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const draftRef = React.useRef<DraftState | null>(null);
  const dirtyRef = React.useRef(false);
  const saveInFlightRef = React.useRef(false);
  const draftRevisionRef = React.useRef(0);
  const saveTimerRef = React.useRef<number | null>(null);
  // Lot 11 (roadmap §15): consecutive failed autosaves; drives the
  // backoff retry effect below (first failure toasts, later ones stay
  // quiet until they succeed or the user hits Retry).
  const retryCountRef = React.useRef(0);
  const [retryPending, setRetryPending] = React.useState(0);
  const textAreasRef = React.useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocusRef = React.useRef<{ id: string; at: "start" | "end" } | null>(null);
  const slashAnchorRef = React.useRef<HTMLElement | null>(null);
  const lastAdoptedUpdatedAtRef = React.useRef<string | null>(null);

  const serverNote = noteQuery.data?.note ?? null;

  const setDraftState = React.useCallback((next: DraftState) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const flushSave = React.useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = draftRef.current;
    if (!current || !dirtyRef.current || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const savingRevision = draftRevisionRef.current;
    let needsImmediateFlush = false;
    setStatus("saving");
    try {
      const res = await updateNote.mutateAsync({
        noteId,
        patch: {
          title: current.title,
          icon: current.icon,
          folderId: current.folderId,
          tagIds: current.tagIds,
          favorite: current.favorite,
          blocks: current.blocks,
        },
      });
      retryCountRef.current = 0;
      setRetryPending(0);
      lastAdoptedUpdatedAtRef.current = res.note.updatedAt;
      setSavedAt(res.note.updatedAt);
      if (draftRevisionRef.current === savingRevision) {
        dirtyRef.current = false;
        clearLocalGaiaDraft(noteId);
        setStatus("saved");
      } else {
        dirtyRef.current = true;
        setStatus("dirty");
        needsImmediateFlush = true;
      }
    } catch (err) {
      dirtyRef.current = true;
      setStatus("error");
      // Lot 11 (roadmap §15): a failed autosave retries on its own with
      // backoff (see the retry effect below) instead of silently losing
      // the edits. Only the first failure toasts; retries stay quiet
      // until they succeed or the user hits Retry.
      if (retryCountRef.current === 0) {
        toast({ variant: "destructive", title: gaiaErrorMessage(err) });
      }
      retryCountRef.current += 1;
      setRetryPending(retryCountRef.current);
    } finally {
      saveInFlightRef.current = false;
      if (needsImmediateFlush && dirtyRef.current && saveTimerRef.current === null) {
        saveTimerRef.current = window.setTimeout(() => void flushSaveRef.current(), 0);
      }
    }
  }, [noteId, toast, updateNote]);

  const flushSaveRef = React.useRef(flushSave);
  React.useEffect(() => {
    // Keep scheduled autosaves pointed at the latest note mutation callback.
    flushSaveRef.current = flushSave;
  });

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void flushSaveRef.current(), 900);
  }, []);

  const applyDraft = React.useCallback(
    (updater: (d: DraftState) => DraftState) => {
      const current = draftRef.current;
      if (!current) return;
      const next = updater(current);
      draftRevisionRef.current += 1;
      setDraftState(next);
      dirtyRef.current = true;
      // Lot 11 (roadmap §15): keep a local backup of the unsaved edits so
      // a closed tab or a crash does not lose them. Cleared on save.
      saveLocalGaiaDraft({
        noteId,
        title: next.title,
        icon: next.icon,
        folderId: next.folderId,
        tagIds: next.tagIds,
        favorite: next.favorite,
        blocksJson: JSON.stringify(next.blocks),
        savedAtMs: Date.now(),
      });
      setStatus((s) => (s === "saving" ? s : "dirty"));
      scheduleSave();
    },
    [noteId, scheduleSave, setDraftState],
  );

  // Adopt the server note into the local draft — never while edits are pending.
  React.useEffect(() => {
    if (!serverNote) return;
    if (dirtyRef.current) return;
    if (lastAdoptedUpdatedAtRef.current === serverNote.updatedAt && draftRef.current) return;
    // Lot 11 (roadmap §15): a local backup newer than the server copy
    // means edits never reached the server (closed tab, network loss).
    // Adopt the backup and push it instead of silently dropping it.
    const local = loadLocalGaiaDraft(noteId);
    if (local && isLocalDraftNewer(local, serverNote.updatedAt)) {
      let localBlocks: GaiaBlock[] = [];
      try {
        const parsed: unknown = JSON.parse(local.blocksJson);
        if (Array.isArray(parsed)) localBlocks = parsed as GaiaBlock[];
      } catch {
        localBlocks = [];
      }
      lastAdoptedUpdatedAtRef.current = serverNote.updatedAt;
      const next: DraftState = {
        title: local.title,
        icon: local.icon,
        folderId: local.folderId,
        tagIds: [...local.tagIds],
        favorite: local.favorite,
        blocks:
          localBlocks.length > 0
            ? localBlocks
            : [{ id: newBlockId(), type: "paragraph", text: "" }],
      };
      setDraftState(next);
      dirtyRef.current = true;
      setStatus("dirty");
      toast({ title: t("gaia.editor.draftRecovered") });
      scheduleSave();
      return;
    }
    lastAdoptedUpdatedAtRef.current = serverNote.updatedAt;
    const next: DraftState = {
      title: serverNote.title,
      icon: serverNote.icon,
      folderId: serverNote.folderId,
      tagIds: [...serverNote.tagIds],
      favorite: serverNote.favorite,
      blocks:
        serverNote.blocks.length > 0
          ? serverNote.blocks
          : [{ id: newBlockId(), type: "paragraph", text: "" }],
    };
    setDraftState(next);
    setSavedAt(serverNote.updatedAt);
    setStatus("saved");
  }, [serverNote, setDraftState, noteId, toast, scheduleSave, t]);

  // Flush pending edits on unmount or when switching notes.
  React.useEffect(() => {
    return () => {
      void flushSaveRef.current();
    };
  }, [noteId]);

  // Lot 11 (roadmap §15): retry the pending save when the network comes
  // back, and warn before closing the tab with unsaved edits.
  React.useEffect(() => {
    const onOnline = () => {
      if (dirtyRef.current) void flushSaveRef.current();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Lot 11 (roadmap §15): backoff retry after a failed autosave (5s,
  // 15s, 30s, then stop). A successful save resets retryPending to 0,
  // which clears any pending retry.
  React.useEffect(() => {
    if (retryPending === 0) return;
    const delay = gaiaSaveRetryDelay(retryPending - 1);
    if (delay == null) return;
    const id = window.setTimeout(() => void flushSaveRef.current(), delay);
    return () => window.clearTimeout(id);
  }, [retryPending]);

  // Pending focus (after split / insert / duplicate).
  React.useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = textAreasRef.current.get(pending.id);
    if (el) {
      el.focus();
      const pos = pending.at === "end" ? el.value.length : 0;
      el.setSelectionRange(pos, pos);
    }
  }, [draft]);

  // Reposition the slash menu on any scroll / resize (never close it).
  React.useEffect(() => {
    if (!slash) return;
    const reposition = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-testid="gaia-slash-menu"]')) return;
      const anchor = slashAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setSlash({ blockId: slash.blockId, query: slash.query, rect: { top: rect.bottom + 4, left: rect.left } });
    };
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [slash]);

  const focusBlock = React.useCallback((id: string, at: "start" | "end") => {
    pendingFocusRef.current = { id, at };
    const el = textAreasRef.current.get(id);
    if (el) {
      el.focus();
      const pos = at === "end" ? el.value.length : 0;
      el.setSelectionRange(pos, pos);
      pendingFocusRef.current = null;
    }
  }, []);

  const ops: GaiaBlockOps = React.useMemo(
    () => ({
      updateText: (id, text) => {
        applyDraft((d) => ({
          ...d,
          blocks: d.blocks.map((b) => (b.id === id ? { ...b, text } : b)),
        }));
      },
      updateBlock: (id, patch) => {
        applyDraft((d) => ({
          ...d,
          blocks: d.blocks.map((b) => {
            if (b.id !== id) return b;
            const next: GaiaBlock = { ...b };
            const record = next as unknown as Record<string, unknown>;
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete record[k];
              else record[k] = v;
            }
            return next;
          }),
        }));
      },
      splitBlock: (id, at) => {
        const d = draftRef.current;
        if (!d) return;
        const idx = d.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return;
        const block = d.blocks[idx];
        const before = block.text.slice(0, at);
        const after = block.text.slice(at);
        const keepType =
          block.type === "bullet" || block.type === "numbered" || block.type === "todo";
        const nextBlock: GaiaBlock = {
          id: newBlockId(),
          type: keepType ? block.type : "paragraph",
          text: after,
          checked: block.type === "todo" ? false : undefined,
        };
        const blocks = [...d.blocks];
        blocks[idx] = { ...block, text: before };
        blocks.splice(idx + 1, 0, nextBlock);
        pendingFocusRef.current = { id: nextBlock.id, at: "start" };
        applyDraft((prev) => ({ ...prev, blocks }));
      },
      mergeBackward: (id) => {
        const d = draftRef.current;
        if (!d) return;
        const idx = d.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return;
        const block = d.blocks[idx];
        if (idx === 0) {
          if (block.text === "" && d.blocks.length > 1) {
            const blocks = d.blocks.slice(1);
            pendingFocusRef.current = { id: blocks[0].id, at: "start" };
            applyDraft((prev) => ({ ...prev, blocks }));
          }
          return;
        }
        const prev = d.blocks[idx - 1];
        const textTypes = ["paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code"];
        if (textTypes.includes(prev.type)) {
          const at = prev.text.length;
          const merged = prev.text + block.text;
          const blocks = [...d.blocks];
          blocks[idx - 1] = { ...prev, text: merged };
          blocks.splice(idx, 1);
          const el = textAreasRef.current.get(prev.id);
          if (el) {
            // Uncontrolled field: write the merged text in the DOM directly.
            el.value = merged;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            el.focus();
            el.setSelectionRange(at, at);
          } else {
            pendingFocusRef.current = { id: prev.id, at: "end" };
          }
          applyDraft((p) => ({ ...p, blocks }));
        } else if (block.text === "") {
          const blocks = d.blocks.filter((b) => b.id !== id);
          pendingFocusRef.current = { id: prev.id, at: "end" };
          applyDraft((p) => ({ ...p, blocks }));
        }
      },
      deleteBlock: (id) => {
        const d = draftRef.current;
        if (!d) return;
        let blocks = d.blocks.filter((b) => b.id !== id);
        if (blocks.length === 0) blocks = [{ id: newBlockId(), type: "paragraph", text: "" }];
        const idx = d.blocks.findIndex((b) => b.id === id);
        const neighbor = blocks[Math.min(Math.max(idx - 1, 0), blocks.length - 1)];
        if (neighbor) pendingFocusRef.current = { id: neighbor.id, at: "end" };
        applyDraft((p) => ({ ...p, blocks }));
      },
      duplicateBlock: (id) => {
        const d = draftRef.current;
        if (!d) return;
        const idx = d.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return;
        const copy: GaiaBlock = { ...structuredClone(d.blocks[idx]), id: newBlockId() };
        const blocks = [...d.blocks];
        blocks.splice(idx + 1, 0, copy);
        pendingFocusRef.current = { id: copy.id, at: "end" };
        applyDraft((p) => ({ ...p, blocks }));
      },
      moveBlock: (id, dir) => {
        const d = draftRef.current;
        if (!d) return;
        const idx = d.blocks.findIndex((b) => b.id === id);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= d.blocks.length) return;
        const blocks = [...d.blocks];
        [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
        applyDraft((p) => ({ ...p, blocks }));
      },
      reorder: (dragId, targetId, position) => {
        const d = draftRef.current;
        if (!d || dragId === targetId) return;
        const dragged = d.blocks.find((b) => b.id === dragId);
        if (!dragged) return;
        const rest = d.blocks.filter((b) => b.id !== dragId);
        const targetIdx = rest.findIndex((b) => b.id === targetId);
        if (targetIdx < 0) return;
        rest.splice(targetIdx + (position === "below" ? 1 : 0), 0, dragged);
        applyDraft((p) => ({ ...p, blocks: rest }));
      },
      focusBlock,
      focusNeighbor: (id, dir) => {
        const d = draftRef.current;
        if (!d) return;
        const idx = d.blocks.findIndex((b) => b.id === id);
        const textTypes = ["paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code"];
        for (let i = idx + dir; i >= 0 && i < d.blocks.length; i += dir) {
          if (!textTypes.includes(d.blocks[i].type)) continue;
          const el = textAreasRef.current.get(d.blocks[i].id);
          if (el) {
            el.focus();
            const pos = dir === 1 ? 0 : el.value.length;
            el.setSelectionRange(pos, pos);
          }
          return;
        }
      },
      registerTextArea: (id, el) => {
        if (el) textAreasRef.current.set(id, el);
        else textAreasRef.current.delete(id);
      },
      openRefPicker: (kind, sourceBlockId) => {
        setRefPicker({ open: true, kind, sourceBlockId });
        setSlash(null);
      },
      navigateToRef: (href) => {
        void flushSaveRef.current().then(() => {
          // Legacy "#/..." refs stored in old notes still navigate.
          if (href.startsWith("#/") || href.startsWith("/")) navigate(href);
          else window.location.href = href;
        });
      },
      openSlashMenu: (blockId, query, anchor) => {
        slashAnchorRef.current = anchor;
        const rect = anchor.getBoundingClientRect();
        setSlash({ blockId, query, rect: { top: rect.bottom + 4, left: rect.left } });
        setSlashActive(0);
      },
      closeSlashMenu: () => setSlash(null),
    }),
    [applyDraft, focusBlock],
  );

  const applySlashItem = React.useCallback(
    (item: GaiaSlashItem) => {
      if (!slash) return;
      const sourceId = slash.blockId;
      if (item.type === "ref") {
        ops.updateText(sourceId, "");
        ops.openRefPicker(item.refKind ?? "", sourceId);
        return;
      }
      if (item.type === "divider") {
        ops.updateBlock(sourceId, { type: "divider", text: "" });
        const d = draftRef.current;
        if (d) {
          const idx = d.blocks.findIndex((b) => b.id === sourceId);
          const para: GaiaBlock = { id: newBlockId(), type: "paragraph", text: "" };
          const blocks = [...d.blocks];
          blocks.splice(idx + 1, 0, para);
          pendingFocusRef.current = { id: para.id, at: "start" };
          applyDraft((p) => ({ ...p, blocks }));
        }
        setSlash(null);
        return;
      }
      if (item.type === "table") {
        ops.updateBlock(sourceId, {
          type: "table",
          text: "",
          rows: [
            [t("gaia.slash.seed.condition"), t("gaia.slash.seed.observation"), t("gaia.slash.seed.result")],
            ["", "", ""],
          ],
        });
      } else if (item.type === "callout") {
        ops.updateBlock(sourceId, { type: "callout", text: "", tone: "info" });
      } else if (item.type === "todo") {
        ops.updateBlock(sourceId, { type: "todo", text: "", checked: false });
      } else {
        ops.updateBlock(sourceId, { type: item.type, text: "" });
      }
      setSlash(null);
      ops.focusBlock(sourceId, "end");
    },
    [slash, ops, applyDraft, t],
  );

  const handleRefPick = React.useCallback(
    (hit: GaiaRefHit) => {
      const sourceId = refPicker.sourceBlockId;
      const refBlock: GaiaBlock = {
        id: newBlockId(),
        type: "ref",
        text: "",
        ref: { kind: hit.kind, id: hit.id, label: hit.label, meta: hit.meta, href: hit.href },
      };
      const d = draftRef.current;
      if (!d) return;
      const idx = sourceId ? d.blocks.findIndex((b) => b.id === sourceId) : -1;
      const blocks = [...d.blocks];
      if (idx >= 0 && blocks[idx].type === "paragraph" && blocks[idx].text === "") {
        blocks[idx] = refBlock;
      } else if (idx >= 0) {
        blocks.splice(idx + 1, 0, refBlock);
      } else {
        blocks.push(refBlock);
      }
      applyDraft((p) => ({ ...p, blocks }));
      setRefPicker((prev) => ({ ...prev, open: false }));
    },
    [applyDraft, refPicker.sourceBlockId],
  );

  const slashItems = React.useMemo(() => {
    if (!slash) return [];
    const all = slashItemsFor(tr);
    const q = slash.query.toLowerCase();
    return all.filter(
      (item) => item.cmd.includes(q) || item.label.toLowerCase().includes(q),
    );
  }, [slash, tr]);

  const folders = foldersQuery.data?.folders ?? [];
  const allTags = tagsQuery.data?.tags ?? [];
  const wordCount = draft ? countWords(draft.blocks) : 0;

  // Lot 11 (roadmap §15): create a note that links back to this one, so
  // the backlink appears in the linked-notes section below the editor.
  const handleCreateLinkedNote = () => {
    void createGaiaNote
      .mutateAsync({
        title: `Note - ${draft?.title?.trim() ? draft.title : "Untitled note"}`,
        blocks: [
          {
            id: newBlockId(),
            type: "ref",
            text: "",
            ref: { kind: "NOTE", id: noteId },
          },
          { id: newBlockId(), type: "paragraph", text: "" },
        ],
      })
      .then(
        (res) => navigate(`/gaia?tab=notes&note=${res.note.id}`),
        (err: unknown) =>
          toast({ title: gaiaErrorMessage(err), variant: "destructive" }),
      );
  };

  const handleKeyDownCapture = (e: React.KeyboardEvent) => {
    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSlashActive((i) => Math.min(slashItems.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSlashActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" && slashItems[slashActive]) {
        e.preventDefault();
        e.stopPropagation();
        applySlashItem(slashItems[slashActive]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSlash(null);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void flushSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "i")) {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "TEXTAREA") {
        e.preventDefault();
        const ta = target as HTMLTextAreaElement;
        const marker = e.key.toLowerCase() === "b" ? "**" : "*";
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? 0;
        const value = ta.value;
        const next = `${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`;
        // Native setter so React's uncontrolled textarea picks up the change.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(ta, next);
        ta.setSelectionRange(end + marker.length, end + marker.length);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  if (noteQuery.isLoading || !draft) {
    return (
      <div data-testid="gaia-editor-loading" className="w-full space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (noteQuery.isError || !serverNote) {
    return (
      <div
        data-testid="gaia-editor-error"
        className="flex w-full flex-col items-center gap-3 rounded-xl border bg-card p-10 text-center"
      >
        <p className="text-sm font-semibold">{t("gaia.editor.loadError")}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void noteQuery.refetch()}>
            {t("common.retry")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("gaia.editor.backToNotes")}
          </Button>
        </div>
      </div>
    );
  }

  const attachedTags = allTags.filter((tag) => draft.tagIds.includes(tag.id));
  const suggestions = allTags.filter((tag) => !draft.tagIds.includes(tag.id)).slice(0, 8);
  const statusDot =
    status === "saved"
      ? "bg-gain"
      : status === "dirty"
        ? "bg-amber-400"
        : status === "saving"
          ? "animate-pulse bg-emerald-500"
          : "bg-loss";
  const statusLabel =
    status === "saved"
      ? `${t("gaia.time.savedPrefix")} ${savedAt ? gaiaRelativeTime(savedAt, tr) : ""}`.trim()
      : status === "dirty"
        ? t("gaia.editor.statusDirty")
        : status === "saving"
          ? t("gaia.editor.statusSaving")
          : t("gaia.editor.statusError");

  const addBlock = () => {
    const block: GaiaBlock = { id: newBlockId(), type: "paragraph", text: "" };
    pendingFocusRef.current = { id: block.id, at: "start" };
    applyDraft((d) => ({ ...d, blocks: [...d.blocks, block] }));
  };

  return (
    <div
      data-testid="gaia-editor"
      onKeyDownCapture={handleKeyDownCapture}
      className="w-full"
    >
      <div className="rounded-xl border bg-card">
        <div className="flex items-start gap-2 border-b px-4 pb-3 pt-4 sm:px-6">
          <IconPicker
            icon={draft.icon}
            onPick={(icon) => applyDraft((d) => ({ ...d, icon }))}
            t={tr}
          />
          <div className="min-w-0 flex-1">
            <input
              data-testid="gaia-title-input"
              value={draft.title}
              onChange={(e) => applyDraft((d) => ({ ...d, title: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = draft.blocks.find((b) =>
                    ["paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code"].includes(b.type),
                  );
                  if (first) ops.focusBlock(first.id, "end");
                }
              }}
              placeholder={t("gaia.shared.untitledNote")}
              aria-label={t("gaia.editor.titleLabel")}
              className="w-full bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
            />
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span
                data-testid="gaia-save-status"
                data-status={status}
                className="inline-flex items-center gap-1.5"
              >
                <span className={`size-2 rounded-full ${statusDot}`} aria-hidden="true" />
                {statusLabel}
                {status === "error" ? (
                  <button
                    type="button"
                    onClick={() => void flushSave()}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    {t("common.retry")}
                  </button>
                ) : null}
              </span>
              <span aria-hidden="true">·</span>
              <span data-testid="gaia-word-count" className="font-mono tabular-nums">
                {wordCount} {wordCount === 1 ? t("gaia.shared.wordOne") : t("gaia.shared.wordMany")}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t("gaia.shared.edited")} {gaiaRelativeTime(serverNote.updatedAt, tr)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="gaia-favorite-toggle"
              aria-label={t("gaia.editor.favoriteTitle")}
              title={draft.favorite ? t("gaia.editor.favoritedTitle") : t("gaia.editor.favoriteTitle")}
              onClick={() => applyDraft((d) => ({ ...d, favorite: !d.favorite }))}
              className="rounded-md p-2 hover:bg-muted"
            >
              <Star
                className={`size-4 ${draft.favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              data-testid="gaia-focus-toggle"
              aria-label={focusMode ? t("gaia.editor.focusExit") : t("gaia.editor.focusEnter")}
              title={focusMode ? t("gaia.editor.focusExitTitle") : t("gaia.editor.focusEnterTitle")}
              onClick={onToggleFocusMode}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {focusMode ? (
                <Minimize2 className="size-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4" aria-hidden="true" />
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="gaia-note-menu"
                  aria-label={t("gaia.shared.noteActions")}
                >
                  {t("gaia.shared.noteActions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() => {
                    void duplicateNote.mutateAsync({ noteId }).then(
                      (res) => onOpenNote(res.note.id),
                      (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                    );
                  }}
                >
                  {t("gaia.editor.duplicateNote")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void createTemplate
                      .mutateAsync({
                        name: draft.title === "" ? t("gaia.shared.untitledTemplate") : draft.title,
                        description: t("gaia.shared.savedFromNote"),
                        icon: draft.icon ?? "📄",
                        fromNoteId: noteId,
                      })
                      .then(
                        () => toast({ title: t("gaia.editor.templatesToast") }),
                        (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                      );
                  }}
                >
                  {t("gaia.editor.saveAsTemplate")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void flushSave().then(() => setVersionsOpen(true));
                  }}
                >
                  <History className="size-3.5" aria-hidden="true" />
                  {t("gaia.dialogs.versionsTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    downloadText(
                      `${slugify(draft.title)}.md`,
                      blocksToMarkdown(draft.title, draft.blocks, tr),
                    );
                    toast({ title: t("gaia.editor.markdownToast") });
                  }}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {t("gaia.editor.exportMarkdown")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="gaia-export-pdf"
                  onClick={() => {
                    void flushSave().then(() => setPrintOpen(true));
                  }}
                >
                  <FileDown className="size-3.5" aria-hidden="true" />
                  {t("gaia.editor.exportPdf")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    void trashNote.mutateAsync(noteId).then(
                      () => {
                        toast({ title: t("gaia.editor.trashToast") });
                        onClose();
                      },
                      (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                    );
                  }}
                  className="text-loss focus:text-loss"
                >
                  {t("gaia.shared.moveToTrash")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              data-testid="gaia-editor-back"
              aria-label={t("gaia.editor.backToNotes")}
              onClick={onClose}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="gaia-open-pattern-library"
            onClick={() => setPatternLibraryOpen(true)}
          >
            <CandlestickChart className="size-3.5" aria-hidden="true" />
            Pattern library
          </Button>
          <Select
            value={draft.folderId ?? "none"}
            onValueChange={(v) =>
              applyDraft((d) => ({ ...d, folderId: v === "none" ? null : v }))
            }
          >
            <SelectTrigger
              data-testid="gaia-folder-select"
              aria-label={t("gaia.editor.folderLabel")}
              className="h-7 w-40 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("gaia.shared.noFolder")}</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="gaia-tags-button"
                className="h-7 text-xs"
              >
                <Tag className="size-3.5" aria-hidden="true" />
                {draft.tagIds.length === 0
                  ? t("gaia.editor.addTags")
                  : `${draft.tagIds.length} ${draft.tagIds.length === 1 ? t("gaia.shared.tagOne") : t("gaia.shared.tagMany")}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" data-testid="gaia-tags-popover" align="start">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim() !== "") {
                    e.preventDefault();
                    const name = newTagName.trim().replace(/^#/, "");
                    setNewTagName("");
                    void createTag.mutateAsync(name).then(
                      (tag) =>
                        applyDraft((d) => ({ ...d, tagIds: [...d.tagIds, tag.id] })),
                      (err: unknown) =>
                        toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
                    );
                  }
                }}
                placeholder={t("gaia.editor.tagInputPlaceholder")}
                aria-label={t("gaia.editor.tagInputLabel")}
                className="h-8 text-xs"
              />
              {attachedTags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {attachedTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      title={t("gaia.shared.removeTag")}
                      onClick={() =>
                        applyDraft((d) => ({ ...d, tagIds: d.tagIds.filter((id) => id !== tag.id) }))
                      }
                      className="inline-flex items-center gap-1 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400"
                    >
                      #{tag.name}
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("gaia.editor.suggestions")}
              </p>
              {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("gaia.editor.noOtherTags")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      title={t("gaia.shared.addTag")}
                      onClick={() =>
                        applyDraft((d) => ({ ...d, tagIds: [...d.tagIds, tag.id] }))
                      }
                      className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
          {serverNote.lessonRef ? (
            <span
              data-testid="gaia-lesson-origin"
              title={`${t("gaia.shared.createdFromLesson")} "${serverNote.lessonRef.lessonTitle}" (${serverNote.lessonRef.courseTitle})`}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
              style={{
                borderColor: "color-mix(in srgb, #14b8a6 35%, transparent)",
                background: "color-mix(in srgb, #14b8a6 10%, transparent)",
              }}
            >
              {serverNote.lessonRef.lessonTitle} · {serverNote.lessonRef.courseTitle}
            </span>
          ) : null}
          <span data-testid="gaia-editor-tags" className="ml-auto flex gap-1.5">
            {attachedTags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                #{tag.name}
              </span>
            ))}
          </span>
        </div>

        <div data-testid="gaia-blocks" className="max-w-prose space-y-1 px-4 py-4 sm:px-6">
          {draft.blocks.map((block, i) => (
            <GaiaBlockRow
              key={block.id}
              block={block}
              index={i}
              total={draft.blocks.length}
              numberedIndex={numberedIndexFor(draft.blocks, i)}
              ops={ops}
              dragState={dragState}
              onDragStart={(id) => setDragState({ dragId: id, overId: null, position: null })}
              onDragOver={(e, id) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                setDragState((prev) =>
                  prev.overId === id && prev.position === position
                    ? prev
                    : { ...prev, overId: id, position },
                );
              }}
              onDragEnd={() => setDragState({ dragId: null, overId: null, position: null })}
              onDrop={(id, patternId, position) => {
                if (patternId && isCandlestickPatternId(patternId)) {
                  applyDraft((current) => {
                    const index = current.blocks.findIndex((block) => block.id === id);
                    const insertionIndex = Math.max(0, index + (position === "below" ? 1 : 0));
                    const blocks = [...current.blocks];
                    blocks.splice(insertionIndex, 0, { id: newBlockId(), type: "pattern", text: "", patternId });
                    return { ...current, blocks };
                  });
                }
                else if (dragState.dragId) {
                  ops.reorder(dragState.dragId, id, dragState.position ?? "below");
                }
                setDragState({ dragId: null, overId: null, position: null });
              }}
              t={tr}
            />
          ))}
          <button
            type="button"
            onClick={addBlock}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-promethe-gaia-pattern")) event.preventDefault();
            }}
            onDrop={(event) => {
              const patternId = event.dataTransfer.getData("application/x-promethe-gaia-pattern");
              if (!isCandlestickPatternId(patternId)) return;
              event.preventDefault();
              applyDraft((current) => ({ ...current, blocks: [...current.blocks, { id: newBlockId(), type: "pattern", text: "", patternId }] }));
            }}
            aria-label={t("gaia.editor.addBlockLabel")}
            className="h-10 w-full rounded-md pl-7 text-left text-sm text-muted-foreground hover:bg-muted/50"
          >
            {t("gaia.editor.addBlockHint")}
          </button>
        </div>
      </div>

      {/* Lot 11 (roadmap §15): notes that reference this note (backlinks),
          and a shortcut to start a linked note. */}
      <div className="mt-4">
        <GaiaLinkedNotesSection
          kind="NOTE"
          id={noteId}
          testidPrefix="gaia-editor"
          creating={createGaiaNote.isPending}
          onCreateNote={handleCreateLinkedNote}
        />
      </div>

      {slash ? (
        <GaiaSlashMenu
          rect={slash.rect}
          items={slashItems}
          activeIndex={slashActive}
          onActiveChange={setSlashActive}
          onSelect={applySlashItem}
          onClose={() => setSlash(null)}
          t={tr}
        />
      ) : null}

      <GaiaPatternLibrary open={patternLibraryOpen} onOpenChange={setPatternLibraryOpen} onInsert={(patternId) => { if (isCandlestickPatternId(patternId)) applyDraft((current) => ({ ...current, blocks: [...current.blocks, { id: newBlockId(), type: "pattern", text: "", patternId }] })); }} />
      <RefPickerDialog
        open={refPicker.open}
        onOpenChange={(open) => setRefPicker((prev) => ({ ...prev, open }))}
        kind={refPicker.kind}
        onPick={handleRefPick}
        t={tr}
      />
      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        noteId={noteId}
        currentBlocks={draft.blocks}
        restoringId={restoringId}
        onRestore={(versionId) => {
          setRestoringId(versionId);
          void restoreVersion
            .mutateAsync({ noteId, versionId })
            .then(
              () => {
                dirtyRef.current = false;
                toast({ title: t("gaia.editor.versionRestoredToast") });
                setVersionsOpen(false);
              },
              (err: unknown) => toast({ variant: "destructive", title: gaiaErrorMessage(err) }),
            )
            .finally(() => setRestoringId(null));
        }}
        t={tr}
      />
      <NotePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        note={serverNote}
        folderName={noteQuery.data?.folderName ?? null}
        tagNames={noteQuery.data?.tagNames ?? []}
        t={tr}
      />
    </div>
  );
}
